-- =============================================================================
-- 05 · Only the shop owner can change the shop.
--
-- Four tables are the shop's own: products, categories, store_settings and
-- delivery_zones. Everything about money and what the customer may buy lives in
-- them, so they are the four tables where "who is allowed to write" matters most.
--
-- Each table is put through the same three questions, in this order:
--
--   1. can a customer write?            must be refused
--   2. can the rider write?             must be refused (a rider is staff, not owner)
--   3. can the shop owner write?        must succeed, and the value must really change
--
-- Order matters: question 1 is proved BEFORE question 3 writes anything, and
-- question 3 is proved by the row count, not by the absence of an error. A
-- successful UPDATE that RLS made invisible does not raise anything, which is why
-- test_result.touches() exists — see the note in 00_auth_stub.sql.
-- =============================================================================

select test_result.begin_suite('05a only admins may write');

-- =============================================================================

set role authenticated;

-- Sanity check before drawing any conclusions from the policies below: the three
-- roles really are what this file assumes they are. If a fixture ever stops
-- setting them, every refusal below would "pass" for the wrong reason.
select test_result.sign_in('11111111-1111-1111-1111-111111111111');
select test_result.eq(
  'Asha really is a customer',
  (select role::text from public.profiles where id = auth.uid()),
  'customer'
);

select test_result.sign_in('44444444-4444-4444-4444-444444444444');
select test_result.eq(
  'the rider really is delivery staff',
  (select role::text from public.profiles where id = auth.uid()),
  'delivery'
);

select test_result.sign_in('33333333-3333-3333-3333-333333333333');
select test_result.eq(
  'the shop owner really is an admin',
  (select role::text from public.profiles where id = auth.uid()),
  'admin'
);

-- =============================================================================
-- products
-- =============================================================================

set role authenticated;
select test_result.sign_in('11111111-1111-1111-1111-111111111111');

select test_result.refused(
  'a customer cannot insert a product',
  $$
  insert into public.products (store_id, category_id, name_en, name_kn, price_paise, unit)
  values ('00000000-0000-4000-8000-000000000001', null,
          'Snuck In', 'ಹೇಗೆಯೇ', 1800, '1 kg')
  $$,
  '42501'
);

-- An UPDATE aimed at a row the caller may not see does NOT raise: RLS makes the
-- row invisible and the statement quietly changes nothing. touches() is the only
-- honest way to assert this. See the note in 00_auth_stub.sql.
select test_result.touches(
  'a customer cannot change a price (0 rows touched)',
  $$
  update public.products set price_paise = 1
    where id = '20000000-0000-4000-8000-000000000001'
  $$,
  0
);

-- The rider is staff. Staff may move orders along; staff may not reprice the shop.
select test_result.sign_in('44444444-4444-4444-4444-444444444444');

select test_result.refused(
  'the rider cannot insert a product',
  $$
  insert into public.products (store_id, category_id, name_en, name_kn, price_paise, unit)
  values ('00000000-0000-4000-8000-000000000001', null,
          'Rider Special', 'ರೈಡರ್', 999, '1 kg')
  $$,
  '42501'
);

select test_result.touches(
  'the rider cannot edit a product (0 rows touched)',
  $$
  update public.products set price_paise = 1
    where id = '20000000-0000-4000-8000-000000000001'
  $$,
  0
);

select test_result.sign_in('33333333-3333-3333-3333-333333333333');

select test_result.touches(
  'the shop owner really can edit a product',
  $$
  update public.products set price_paise = 1800
    where id = '20000000-0000-4000-8000-000000000001'
  $$,
  1
);

select test_result.eq(
  'and the new price is really in the table',
  (select price_paise from public.products where id = '20000000-0000-4000-8000-000000000001'),
  1800
);

-- =============================================================================
-- categories
-- =============================================================================

set role authenticated;
select test_result.sign_in('11111111-1111-1111-1111-111111111111');

select test_result.refused(
  'a customer cannot insert a category',
  $$
  insert into public.categories (store_id, name_en, name_kn)
  values ('00000000-0000-4000-8000-000000000001', 'Aisle 9', 'ಮಡಿ ೯')
  $$,
  '42501'
);

select test_result.touches(
  'a customer cannot rename a category (0 rows touched)',
  $$
  update public.categories set name_en = 'Mine Now'
    where id = '10000000-0000-4000-8000-000000000001'
  $$,
  0
);

select test_result.sign_in('44444444-4444-4444-4444-444444444444');

select test_result.touches(
  'the rider cannot rename a category (0 rows touched)',
  $$
  update public.categories set name_en = 'Rider Renamed'
    where id = '10000000-0000-4000-8000-000000000001'
  $$,
  0
);

select test_result.sign_in('33333333-3333-3333-3333-333333333333');

-- Insert, then read it back, then clean up. Proving an INSERT is allowed needs
-- the row to exist, and leaving junk in the catalogue would make later counts
-- confusing.
do $$
declare
  v_id uuid;
begin
  insert into public.categories (store_id, name_en, name_kn)
  values ('00000000-0000-4000-8000-000000000001', 'Test Aisle', 'ಟೆಸ್ಟ್ ಮಡಿ')
  returning id into v_id;

  perform test_result.ok(
    'the shop owner really can add a category',
    exists (select 1 from public.categories where id = v_id)
  );

  perform test_result.touches(
    'and the shop owner can take it away again',
    format('delete from public.categories where id = %L', v_id),
    1
  );
end;
$$;

-- =============================================================================
-- store_settings
-- =============================================================================

set role authenticated;
select test_result.sign_in('11111111-1111-1111-1111-111111111111');

-- This is the one customers would most like to write: raise the minimum order,
-- or set the delivery fee to zero.
select test_result.touches(
  'a customer cannot raise the minimum order value (0 rows touched)',
  $$
  update public.store_settings set min_order_value_paise = 999999
    where store_id = '00000000-0000-4000-8000-000000000001'
  $$,
  0
);

select test_result.touches(
  'a customer cannot set the delivery fee to zero (0 rows touched)',
  $$
  update public.store_settings set delivery_fee_paise = 0
    where store_id = '00000000-0000-4000-8000-000000000001'
  $$,
  0
);

select test_result.touches(
  'the rider cannot change the settings (0 rows touched)',
  $$
  update public.store_settings set delivery_fee_paise = 0
    where store_id = '00000000-0000-4000-8000-000000000001'
  $$,
  0
);

select test_result.sign_in('33333333-3333-3333-3333-333333333333');

select test_result.touches(
  'the shop owner really can change the delivery fee',
  $$
  update public.store_settings set delivery_fee_paise = 2500
    where store_id = '00000000-0000-4000-8000-000000000001'
  $$,
  1
);

-- =============================================================================
-- delivery_zones
-- =============================================================================

set role authenticated;
select test_result.sign_in('11111111-1111-1111-1111-111111111111');

-- Adding a cheap zone would make delivery to a pincode free for everyone.
select test_result.refused(
  'a customer cannot add a delivery zone',
  $$
  insert into public.delivery_zones (store_id, pincode, area_name_en, area_name_kn, delivery_fee_paise)
  values ('00000000-0000-4000-8000-000000000001', '573001', 'Test Area', 'ಟೆಸ್ಟ್ ಪ್ರದೇಶ', 0)
  $$,
  '42501'
);

select test_result.touches(
  'a customer cannot zero out an existing zone fee (0 rows touched)',
  $$
  update public.delivery_zones set delivery_fee_paise = 0
    where id = '30000000-0000-4000-8000-000000000001'
  $$,
  0
);

select test_result.touches(
  'the rider cannot change a delivery zone (0 rows touched)',
  $$
  update public.delivery_zones set delivery_fee_paise = 0
    where id = '30000000-0000-4000-8000-000000000001'
  $$,
  0
);

select test_result.sign_in('33333333-3333-3333-3333-333333333333');

select test_result.touches(
  'the shop owner really can change a zone fee',
  $$
  update public.delivery_zones set delivery_fee_paise = 1500
    where id = '30000000-0000-4000-8000-000000000001'
  $$,
  1
);

-- =============================================================================
-- Nothing the customers tried actually landed.
-- Re-read as the table owner, which no RLS policy applies to.
-- =============================================================================

reset role;

select test_result.eq(
  'no customer product slipped in',
  (select count(*) from public.products where name_en in ('Snuck In', 'Rider Special')),
  0
);

select test_result.eq(
  'no customer category slipped in',
  (select count(*) from public.categories where name_en in ('Aisle 9', 'Test Aisle', 'Rider Renamed')),
  0
);

select test_result.eq(
  'the minimum order value is untouched',
  (select min_order_value_paise from public.store_settings
    where store_id = '00000000-0000-4000-8000-000000000001'),
  10000
);

select test_result.eq(
  'the Kunigal zone fee is untouched',
  (select delivery_fee_paise from public.delivery_zones
    where id = '30000000-0000-4000-8000-000000000001'),
  1500
);

select test_result.eq(
  'no customer delivery zone slipped in',
  (select count(*) from public.delivery_zones where pincode = '573001'),
  0
);
