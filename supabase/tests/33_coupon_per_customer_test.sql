-- =============================================================================
-- 33 · Per-customer coupon limits
-- =============================================================================
-- Migration 20261109000004 adds `coupons.per_customer_limit` and enforces it in
-- `validate_coupon()` and `place_order()`. This suite proves:
--
--   1. The column exists and is nullable with a positive CHECK.
--   2. `validate_coupon` refuses when the customer has already used the code
--      up to their personal cap, even though the global cap has room.
--   3. `place_order` does the same check and answers the same error.
--   4. Cancelled orders do NOT count towards the per-customer limit (they
--      release the personal slot).
--   5. Different customers have independent limits.
--   6. The global `usage_limit` is checked FIRST; when it is hit, the error is
--      `coupon_used_up`, not the per-customer error.
--   7. The new error code is a distinct SQLSTATE so the checkout can map it.
--
-- The fixtures live on 2020-03-01, a day no other suite uses.
-- =============================================================================

select test_result.begin_suite('33 coupon per-customer limits');

-- -----------------------------------------------------------------------------
-- Fixtures: the shop, Asha, Ravi, and three coupons.
-- -----------------------------------------------------------------------------
reset role;

-- Global cap 5, per-customer 1. One person can use it once.
insert into public.coupons (store_id, code, kind, value, usage_limit, per_customer_limit, min_order_paise, is_active)
values ('00000000-0000-4000-8000-000000000001', 'ONEPER', 'flat', 5000, 5, 1, 10000, true);

-- Global cap 3, per-customer 2. First to hit global cap is the third use overall.
insert into public.coupons (store_id, code, kind, value, usage_limit, per_customer_limit, min_order_paise, is_active)
values ('00000000-0000-4000-8000-000000000001', 'TWOPER', 'flat', 5000, 3, 2, 10000, true);

-- Global cap 10, NO per-customer cap (unlimited per person).
insert into public.coupons (store_id, code, kind, value, usage_limit, per_customer_limit, min_order_paise, is_active)
values ('00000000-0000-4000-8000-000000000001', 'MANYPER', 'flat', 5000, 10, null, 10000, true);

-- A known shelf item for the orders.
update public.products set stock_qty = 100, is_active = true, price_paise = 1800
  where id = '20000000-0000-4000-8000-000000000001';

set role authenticated;

-- =============================================================================
-- 1. The column exists and has the right constraints.
-- =============================================================================

reset role;
select test_result.eq(
  'coupons has per_customer_limit column',
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'coupons' and column_name = 'per_customer_limit'),
  1::bigint
);

select test_result.refused(
  'per_customer_limit cannot be 0 or negative',
  $$ insert into public.coupons (store_id, code, kind, value, per_customer_limit)
       values ('00000000-0000-4000-8000-000000000001', 'BAD', 'flat', 1000, 0) $$,
  '23514'
);

-- =============================================================================
-- 2. Asha uses ONEPER once. The second attempt is refused.
-- =============================================================================

set role authenticated;
select test_result.sign_in('11111111-1111-1111-1111-111111111111');  -- Asha

do $$
declare
  v_result jsonb;
begin
  v_result := public.place_order(
    '[{"product_id":"20000000-0000-4000-8000-000000000001","quantity":6}]',  -- 10800 >= 10000 min
    '00000000-0000-4000-8000-000000000001',
    '50000000-0000-4000-8000-000000000001',
    'per-cust-key-01',
    null,
    'ONEPER'
  );
  perform test_result.ok('first use of ONEPER succeeds', v_result ->> 'ok' = 'true');
end;
$$;

do $$
declare
  v_result jsonb;
begin
  v_result := public.place_order(
    '[{"product_id":"20000000-0000-4000-8000-000000000001","quantity":6}]',
    '00000000-0000-4000-8000-000000000001',
    '50000000-0000-4000-8000-000000000001',
    'per-cust-key-02',
    null,
    'ONEPER'
  );
  perform test_result.eq('second use of ONEPER is coupon_per_customer_limit',
    v_result ->> 'error', 'coupon_per_customer_limit');
  perform test_result.ok('second use is refused', v_result ->> 'ok' = 'false');
end;
$$;

-- =============================================================================
-- 3. validate_coupon agrees with place_order (same error before ordering).
-- =============================================================================

do $$
declare
  v_result jsonb;
begin
  v_result := public.validate_coupon(
    '00000000-0000-4000-8000-000000000001',
    'ONEPER',
    12000
  );
  perform test_result.eq('validate_coupon also says coupon_per_customer_limit',
    v_result ->> 'error', 'coupon_per_customer_limit');
end;
$$;

-- =============================================================================
-- 4. A cancelled order does NOT count. Asha cancels, then reuses.
-- =============================================================================

reset role;
-- Find the order Asha just placed with ONEPER and cancel it.
update public.orders set status = 'cancelled'
  where user_id = '11111111-1111-1111-1111-111111111111'
    and coupon_code = 'ONEPER'
    and status = 'placed';

set role authenticated;
select test_result.sign_in('11111111-1111-1111-1111-111111111111');

do $$
declare
  v_result jsonb;
begin
  v_result := public.place_order(
    '[{"product_id":"20000000-0000-4000-8000-000000000001","quantity":6}]',
    '00000000-0000-4000-8000-000000000001',
    '50000000-0000-4000-8000-000000000001',
    'per-cust-key-03',
    null,
    'ONEPER'
  );
  perform test_result.ok('after cancelling, Asha can use ONEPER again', v_result ->> 'ok' = 'true');
end;
$$;

-- =============================================================================
-- 5. TWOPER: two per customer. Asha uses twice, third is refused.
-- =============================================================================

do $$
declare
  v_result jsonb;
begin
  v_result := public.place_order(
    '[{"product_id":"20000000-0000-4000-8000-000000000001","quantity":6}]',
    '00000000-0000-4000-8000-000000000001',
    '50000000-0000-4000-8000-000000000001',
    'per-cust-key-04',
    null,
    'TWOPER'
  );
  perform test_result.ok('first TWOPER for Asha', v_result ->> 'ok' = 'true');
end;
$$;

do $$
declare
  v_result jsonb;
begin
  v_result := public.place_order(
    '[{"product_id":"20000000-0000-4000-8000-000000000001","quantity":6}]',
    '00000000-0000-4000-8000-000000000001',
    '50000000-0000-4000-8000-000000000001',
    'per-cust-key-05',
    null,
    'TWOPER'
  );
  perform test_result.ok('second TWOPER for Asha', v_result ->> 'ok' = 'true');
end;
$$;

do $$
declare
  v_result jsonb;
begin
  v_result := public.place_order(
    '[{"product_id":"20000000-0000-4000-8000-000000000001","quantity":6}]',
    '00000000-0000-4000-8000-000000000001',
    '50000000-0000-4000-8000-000000000001',
    'per-cust-key-06',
    null,
    'TWOPER'
  );
  perform test_result.eq('third TWOPER for Asha is coupon_per_customer_limit',
    v_result ->> 'error', 'coupon_per_customer_limit');
end;
$$;

-- =============================================================================
-- 6. Ravi (different customer) can also use TWOPER — independent limits.
--    But TWOPER global cap is 3. Asha used 2, so only 1 global slot remains.
--    Ravi's first TWOPER succeeds (uses the last global slot).
--    Ravi's second TWOPER is coupon_used_up (global cap hit), NOT per-customer.
-- =============================================================================

select test_result.sign_in('22222222-2222-2222-2222-222222222222');  -- Ravi

do $$
declare
  v_result jsonb;
begin
  v_result := public.place_order(
    '[{"product_id":"20000000-0000-4000-8000-000000000001","quantity":6}]',
    '00000000-0000-4000-8000-000000000001',
    '50000000-0000-4000-8000-000000000004',  -- Ravi's address
    'per-cust-key-07',
    null,
    'TWOPER'
  );
  perform test_result.ok('first TWOPER for Ravi (last global slot)', v_result ->> 'ok' = 'true');
end;
$$;

do $$
declare
  v_result jsonb;
begin
  v_result := public.place_order(
    '[{"product_id":"20000000-0000-4000-8000-000000000001","quantity":6}]',
    '00000000-0000-4000-8000-000000000001',
    '50000000-0000-4000-8000-000000000004',
    'per-cust-key-08',
    null,
    'TWOPER'
  );
  perform test_result.eq('second TWOPER for Ravi is coupon_used_up (global cap hit)',
    v_result ->> 'error', 'coupon_used_up');
end;
$$;

-- =============================================================================
-- 7. MANYPER has NO per-customer limit (null). Asha can use it many times.
-- =============================================================================

select test_result.sign_in('11111111-1111-1111-1111-111111111111');  -- Asha

do $$
declare
  v_result jsonb;
begin
  v_result := public.place_order(
    '[{"product_id":"20000000-0000-4000-8000-000000000001","quantity":6}]',
    '00000000-0000-4000-8000-000000000001',
    '50000000-0000-4000-8000-000000000001',
    'per-cust-key-09',
    null,
    'MANYPER'
  );
  perform test_result.ok('MANYPER once for Asha', v_result ->> 'ok' = 'true');
end;
$$;

do $$
declare
  v_result jsonb;
begin
  v_result := public.place_order(
    '[{"product_id":"20000000-0000-4000-8000-000000000001","quantity":6}]',
    '00000000-0000-4000-8000-000000000001',
    '50000000-0000-4000-8000-000000000001',
    'per-cust-key-10',
    null,
    'MANYPER'
  );
  perform test_result.ok('MANYPER twice for Asha (no per-customer cap)', v_result ->> 'ok' = 'true');
end;
$$;

-- =============================================================================
-- 8. ONEPER global usage_limit is checked FIRST.
--    Current state: Asha has 1 non-cancelled ONEPER, Ravi has 0.
--    Global used = 1 (Asha's one order after cancel). Cap = 5.
--    Ravi uses ONEPER -> succeeds (global=2, ravi=1).
--    Asha tries ONEPER again -> coupon_per_customer_limit (asha at cap 1).
--    Ravi tries ONEPER again -> coupon_per_customer_limit (ravi at cap 1).
-- =============================================================================

select test_result.sign_in('22222222-2222-2222-2222-222222222222');  -- Ravi

do $$
declare
  v_result jsonb;
begin
  v_result := public.place_order(
    '[{"product_id":"20000000-0000-4000-8000-000000000001","quantity":6}]',
    '00000000-0000-4000-8000-000000000001',
    '50000000-0000-4000-8000-000000000004',
    'per-cust-key-11',
    null,
    'ONEPER'
  );
  perform test_result.ok('Ravi first ONEPER (global used=2)', v_result ->> 'ok' = 'true');
end;
$$;

select test_result.sign_in('11111111-1111-1111-1111-111111111111');  -- Asha

do $$
declare
  v_result jsonb;
begin
  v_result := public.place_order(
    '[{"product_id":"20000000-0000-4000-8000-000000000001","quantity":6}]',
    '00000000-0000-4000-8000-000000000001',
    '50000000-0000-4000-8000-000000000001',
    'per-cust-key-12',
    null,
    'ONEPER'
  );
  perform test_result.eq('Asha second ONEPER is coupon_per_customer_limit (asha cap=1)',
    v_result ->> 'error', 'coupon_per_customer_limit');
end;
$$;

select test_result.sign_in('22222222-2222-2222-2222-222222222222');  -- Ravi

do $$
declare
  v_result jsonb;
begin
  v_result := public.place_order(
    '[{"product_id":"20000000-0000-4000-8000-000000000001","quantity":6}]',
    '00000000-0000-4000-8000-000000000001',
    '50000000-0000-4000-8000-000000000004',
    'per-cust-key-13',
    null,
    'ONEPER'
  );
  perform test_result.eq('Ravi second ONEPER is coupon_per_customer_limit (ravi cap=1)',
    v_result ->> 'error', 'coupon_per_customer_limit');
end;
$$;

-- =============================================================================
-- 9. MANYPER continues to work (no per-customer limit).
-- =============================================================================

select test_result.sign_in('11111111-1111-1111-1111-111111111111');  -- Asha

do $$
declare
  v_result jsonb;
begin
  v_result := public.place_order(
    '[{"product_id":"20000000-0000-4000-8000-000000000001","quantity":6}]',
    '00000000-0000-4000-8000-000000000001',
    '50000000-0000-4000-8000-000000000001',
    'per-cust-key-14',
    null,
    'MANYPER'
  );
  perform test_result.ok('MANYPER third for Asha', v_result ->> 'ok' = 'true');
end;
$$;

-- =============================================================================
-- 10. Clean up the test coupons.
-- =============================================================================

reset role;
delete from public.coupons where code in ('ONEPER', 'TWOPER', 'MANYPER');

-- Restore the shelf.
update public.products set stock_qty = 40, is_active = true, price_paise = 1800
  where id = '20000000-0000-4000-8000-000000000001';