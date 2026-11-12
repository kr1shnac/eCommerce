-- =============================================================================
-- 31 · The shop's door: open or closed, from the owner's phone
--
-- `store_settings.is_open` and `place_order()`'s "store_closed" refusal have
-- existed since migrations 05 and 08. This suite proves the new write path:
--
--   1. a signed-out visitor, a customer and a rider cannot close the shop —
--      and are refused with an error, not a silent no-op;
--   2. the owner can, and the function returns the row as STORED, not as sent;
--   3. closing the shop really stops orders at `place_order()`, with no order
--      row and no stock movement;
--   4. the plain `.update()` the app must never use touches zero rows;
--   5. NULL is refused rather than read as "closed";
--   6. the fixture is put back open for the concurrency suite that follows.
-- =============================================================================

select test_result.begin_suite('31 set_shop_open');

-- A known starting point. The owner (the table owner here, not the admin user)
-- sets it directly, because that is not what is under test.
reset role;

update public.store_settings
   set is_open = true
 where store_id = '00000000-0000-4000-8000-000000000001';

update public.products
   set stock_qty = 40, is_active = true, price_paise = 1800
 where id = '20000000-0000-4000-8000-000000000001';   -- Tomato Rs 18

select test_result.eq(
  'fixture: the shop starts open',
  (select is_open::text from public.store_settings
    where store_id = '00000000-0000-4000-8000-000000000001'),
  'true'
);

-- =============================================================================
-- 1. The door: only the shop may use it.
-- =============================================================================

set role anon;

select test_result.refused(
  'a signed-out visitor cannot close the shop',
  $$ select public.set_shop_open(false) $$,
  '42501'
);

set role authenticated;
select test_result.sign_in('11111111-1111-1111-1111-111111111111');   -- Asha

select test_result.refused(
  'a customer cannot close the shop',
  $$ select public.set_shop_open(false) $$,
  '42501'
);

select test_result.sign_in('44444444-4444-4444-4444-444444444444');   -- Rider

select test_result.refused(
  'a delivery partner cannot close the shop',
  $$ select public.set_shop_open(false) $$,
  '42501'
);

-- =============================================================================
-- 2. The owner can, and learns the stored answer.
-- =============================================================================

select test_result.sign_in('33333333-3333-3333-3333-333333333333');   -- Owner

do $$
declare
  v_settings public.store_settings;
begin
  v_settings := public.set_shop_open(false);

  perform test_result.eq(
    'the owner closes the shop and gets the stored row back',
    v_settings.is_open::text,
    'false'
  );
end;
$$;

reset role;

select test_result.eq(
  'the closed state is really in the table',
  (select is_open::text from public.store_settings
    where store_id = '00000000-0000-4000-8000-000000000001'),
  'false'
);

-- =============================================================================
-- 3. A closed shop refuses the order, at the gate that charges money.
-- =============================================================================

set role authenticated;
select test_result.sign_in('11111111-1111-1111-1111-111111111111');

do $$
declare
  v_result jsonb;
begin
  -- 6 x Tomato at 1800 = 10800, over the 10000 minimum, so nothing but the
  -- closed door can be the reason this is refused.
  v_result := public.place_order(
    '[{"product_id":"20000000-0000-4000-8000-000000000001","quantity":6}]',
    '00000000-0000-4000-8000-000000000001',
    '50000000-0000-4000-8000-000000000001',
    'closed-shop-key-0001'
  );

  perform test_result.ok(
    'a closed shop answers ok=false',
    v_result ->> 'ok' = 'false',
    v_result::text
  );
  perform test_result.eq(
    'a closed shop says store_closed',
    v_result ->> 'error',
    'store_closed'
  );
end;
$$;

reset role;

select test_result.eq(
  'no order was created for a closed shop',
  (select count(*) from public.orders where idempotency_key = 'closed-shop-key-0001'),
  0
);

select test_result.eq(
  'the refused order did not touch stock',
  (select stock_qty from public.products where id = '20000000-0000-4000-8000-000000000001'),
  40
);

-- =============================================================================
-- 4. The silent no-op this RPC exists to replace.
-- =============================================================================

set role authenticated;
select test_result.sign_in('11111111-1111-1111-1111-111111111111');

select test_result.touches(
  'a customer''s direct update touches zero rows and raises nothing',
  $$ update public.store_settings set is_open = true $$,
  0
);

-- =============================================================================
-- 5. Reopening works, and NULL is refused rather than read as "closed".
-- =============================================================================

select test_result.sign_in('33333333-3333-3333-3333-333333333333');

do $$
declare
  v_settings public.store_settings;
begin
  v_settings := public.set_shop_open(true);

  perform test_result.eq(
    'the owner reopens the shop',
    v_settings.is_open::text,
    'true'
  );
end;
$$;

select test_result.refused(
  'a NULL is refused, not read as false',
  $$ select public.set_shop_open(null) $$,
  '22004'
);

-- =============================================================================
-- 6. Put the fixture back for the concurrency suite that runs next.
-- =============================================================================

reset role;

update public.store_settings
   set is_open = true
 where store_id = '00000000-0000-4000-8000-000000000001';

update public.products
   set stock_qty = 40, is_active = true, price_paise = 1800
 where id = '20000000-0000-4000-8000-000000000001';

select test_result.eq(
  'fixture restored: the shop is open again',
  (select is_open::text from public.store_settings
    where store_id = '00000000-0000-4000-8000-000000000001'),
  'true'
);
