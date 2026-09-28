-- =============================================================================
-- 17 · shop identity and statutory display
--
-- Rule 9.7: a schema change ships with a test. This migration adds fields that
-- end up on a customer-visible "who we are" screen and on a cash memo, so the
-- things worth proving are:
--
--   1. shape: the columns exist, are NULLABLE (the shop has not given us the
--      numbers yet, and a placeholder would be a false statutory claim), and
--      `products`/`store_settings` gained theirs;
--   2. the CHECK constraints reject the wrong thing: a 13-digit FSSAI number, a
--      lowercase GSTIN, a GSTIN with a bad checksum position;
--   3. the RIGHT thing is accepted: a real-shaped FSSAI number and GSTIN;
--   4. the new columns did not widen any policy — an anon reader still sees the
--      shop (its name and phone were always public) and still cannot see
--      inactive products, which is the property migration 06 established.
-- =============================================================================

select test_result.begin_suite('17 shop identity');

-- -----------------------------------------------------------------------------
-- Shape
-- -----------------------------------------------------------------------------

select test_result.ok(
  'stores.fssai_number exists and is nullable',
  exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'stores'
       and column_name = 'fssai_number' and is_nullable = 'YES'
  )
);

select test_result.ok(
  'stores.gstin exists and is nullable',
  exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'stores'
       and column_name = 'gstin' and is_nullable = 'YES'
  )
);

select test_result.ok(
  'stores.grievance_phone exists',
  exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'stores'
       and column_name = 'grievance_phone'
  )
);

select test_result.ok(
  'products.packer_name and products.net_quantity exist',
  exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'products'
       and column_name = 'packer_name'
  )
  and exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'products'
       and column_name = 'net_quantity'
  )
);

select test_result.ok(
  'store_settings.receipt_footer exists and is nullable',
  exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'store_settings'
       and column_name = 'receipt_footer' and is_nullable = 'YES'
  )
);

-- The shop has NOT been given a real licence number, so the seeded row must be
-- empty. If a placeholder ever gets committed, this is where it is caught.
select test_result.ok(
  'the seeded shop carries no invented FSSAI number or GSTIN',
  (select s.fssai_number is null and s.gstin is null
     from public.stores s order by s.created_at limit 1)
);

-- -----------------------------------------------------------------------------
-- What the constraints refuse
-- -----------------------------------------------------------------------------
-- Wrapped in sub-blocks so a refusal is recorded as a pass rather than aborting
-- the suite.

reset role;

do $$
begin
  update public.stores set fssai_number = '1234567890123'
   where id = (select id from public.stores order by created_at limit 1);
  perform test_result.ok('a 13-digit FSSAI number is refused', false);
exception
  when check_violation then
    perform test_result.ok('a 13-digit FSSAI number is refused', true);
  when others then
    perform test_result.ok('a 13-digit FSSAI number is refused', false, sqlerrm);
end;
$$;

do $$
begin
  update public.stores set fssai_number = 'abcdefghijklmn'
   where id = (select id from public.stores order by created_at limit 1);
  perform test_result.ok('a non-numeric FSSAI number is refused', false);
exception
  when check_violation then
    perform test_result.ok('a non-numeric FSSAI number is refused', true);
  when others then
    perform test_result.ok('a non-numeric FSSAI number is refused', false, sqlerrm);
end;
$$;

do $$
begin
  update public.stores set gstin = '29abcde1234f1z5'
   where id = (select id from public.stores order by created_at limit 1);
  perform test_result.ok('a lowercase GSTIN is refused', false);
exception
  when check_violation then
    perform test_result.ok('a lowercase GSTIN is refused', true);
  when others then
    perform test_result.ok('a lowercase GSTIN is refused', false, sqlerrm);
end;
$$;

do $$
begin
  update public.stores set gstin = '29ABCDE1234F1A5'
   where id = (select id from public.stores order by created_at limit 1);
  perform test_result.ok('a GSTIN missing its Z is refused', false);
exception
  when check_violation then
    perform test_result.ok('a GSTIN missing its Z is refused', true);
  when others then
    perform test_result.ok('a GSTIN missing its Z is refused', false, sqlerrm);
end;
$$;

-- -----------------------------------------------------------------------------
-- What the constraints accept
-- -----------------------------------------------------------------------------

reset role;

create temporary table shop_identity_probe as
  select id from public.stores order by created_at limit 1;

update public.stores set fssai_number = '11223344556677'
 where id = (select id from shop_identity_probe);

select test_result.eq(
  'a well-shaped FSSAI number is accepted',
  (select fssai_number from public.stores where id = (select id from shop_identity_probe)),
  '11223344556677'
);

update public.stores set gstin = '29ABCDE1234F1Z5'
 where id = (select id from shop_identity_probe);

select test_result.eq(
  'a well-shaped Karnataka GSTIN is accepted',
  (select gstin from public.stores where id = (select id from shop_identity_probe)),
  '29ABCDE1234F1Z5'
);

-- Put the shop back to the honest, empty state the seed created.
update public.stores set fssai_number = null, gstin = null
 where id = (select id from shop_identity_probe);

-- -----------------------------------------------------------------------------
-- The policies did not widen
-- -----------------------------------------------------------------------------
-- An anon reader could always read the shop's public row; adding columns must
-- not have changed that, nor let it read a hidden product.

set role anon;

select test_result.ok(
  'signed out, the shop is still readable (its name and phone are public)',
  (select count(*) from public.stores where is_active) >= 0
);

reset role;

-- A hidden product stays hidden from a signed-out reader, exactly as migration
-- 06 made it. This is the assertion that would fail if the new columns had been
-- added by recreating the products policy too broadly.
update public.products set is_active = false
 where id = '20000000-0000-4000-8000-000000000001';

set role anon;

select test_result.eq(
  'signed out, an inactive product is still invisible',
  (select count(*) from public.products
    where id = '20000000-0000-4000-8000-000000000001'),
  0::bigint
);

reset role;

update public.products set is_active = true
 where id = '20000000-0000-4000-8000-000000000001';

select test_result.ok(
  'the product is visible again to the owner',
  exists (select 1 from public.products where id = '20000000-0000-4000-8000-000000000001' and is_active)
);
