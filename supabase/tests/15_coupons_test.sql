-- =============================================================================
-- 15 · coupons — the discount is computed by the database, never the app.
--
-- The theme is rule 9.1: the customer sends a CODE and nothing else. The
-- discount, the floor, the cap and the minimum all come from Postgres. This file
-- proves the arithmetic, the refusals, and that a use is counted exactly once.
--
-- Fixtures used:
--   store    00000000-0000-4000-8000-000000000001
--   address  50000000-0000-4000-8000-000000000001  (Asha, pincode 572130)
--   Asha     11111111-1111-1111-1111-111111111111
--   SAVE10   10% off, min Rs 199, capped at Rs 40
--   KUNIGAL50 Rs 50 off, min Rs 499
-- =============================================================================

select test_result.begin_suite('15 coupons');

-- A known starting point: nobody has used a code yet.
reset role;
update public.coupons set used_count = 0 where store_id = '00000000-0000-4000-8000-000000000001';

-- =============================================================================
-- 1. Shape
-- =============================================================================

select test_result.eq(
  'coupons has row level security enabled',
  (select relrowsecurity::text from pg_class where oid = 'public.coupons'::regclass),
  'true'
);

select test_result.eq(
  'coupons has exactly one policy (the shop owner)',
  (select count(*) from pg_policies where schemaname = 'public' and tablename = 'coupons'),
  1::bigint
);

select test_result.eq(
  'an order now remembers the coupon code',
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'orders' and column_name = 'coupon_code'),
  1::bigint
);

-- A percent coupon can never be more than 100%.
select test_result.refused(
  'a percent coupon above 100% is refused by a constraint',
  $$insert into public.coupons (store_id, code, kind, value)
    values ('00000000-0000-4000-8000-000000000001', 'TOOMUCH', 'percent', 150)$$,
  '23514'
);

-- =============================================================================
-- 2. The codes are the shop's, not the customer's
-- =============================================================================

set role authenticated;
select test_result.sign_in('11111111-1111-1111-1111-111111111111');

select test_result.eq(
  'a customer cannot list the coupon codes directly',
  (select count(*) from public.coupons),
  0::bigint
);

-- =============================================================================
-- 3. validate_coupon — the arithmetic, in paise
-- =============================================================================

select test_result.eq(
  'SAVE10: 10% of a Rs 300 basket is Rs 30',
  (public.validate_coupon('00000000-0000-4000-8000-000000000001', 'SAVE10', 30000) ->> 'discount_paise')::bigint,
  3000::bigint
);

select test_result.eq(
  'SAVE10: a percent discount is floored, not rounded up (10% of 19999)',
  (public.validate_coupon('00000000-0000-4000-8000-000000000001', 'SAVE10', 19999) ->> 'discount_paise')::bigint,
  1999::bigint
);

select test_result.eq(
  'SAVE10: a percent discount is capped (10% of Rs 2000 is Rs 40, not Rs 200)',
  (public.validate_coupon('00000000-0000-4000-8000-000000000001', 'SAVE10', 200000) ->> 'discount_paise')::bigint,
  4000::bigint
);

select test_result.eq(
  'KUNIGAL50: the flat Rs 50 applies at Rs 499',
  (public.validate_coupon('00000000-0000-4000-8000-000000000001', 'KUNIGAL50', 49900) ->> 'discount_paise')::bigint,
  5000::bigint
);

select test_result.eq(
  'SAVE10: below its minimum is refused',
  public.validate_coupon('00000000-0000-4000-8000-000000000001', 'SAVE10', 10000) ->> 'error',
  'coupon_min_order'
);

select test_result.eq(
  'KUNIGAL50: it tells the customer the minimum',
  (public.validate_coupon('00000000-0000-4000-8000-000000000001', 'KUNIGAL50', 40000) ->> 'min_order_paise')::bigint,
  49900::bigint
);

select test_result.eq(
  'an unknown code is refused',
  public.validate_coupon('00000000-0000-4000-8000-000000000001', 'NOPE123', 30000) ->> 'error',
  'coupon_not_found'
);

select test_result.eq(
  'an empty code is refused',
  public.validate_coupon('00000000-0000-4000-8000-000000000001', '', 30000) ->> 'error',
  'empty_code'
);

select test_result.eq(
  'the code is matched whatever case it is typed in',
  public.validate_coupon('00000000-0000-4000-8000-000000000001', 'save10', 30000) ->> 'code',
  'SAVE10'
);

-- =============================================================================
-- 4. active_offers — the marketing rail sees the live codes and nothing else
-- =============================================================================

select test_result.eq(
  'two offers are live for the shop today',
  (select jsonb_array_length(public.active_offers('00000000-0000-4000-8000-000000000001'))),
  2::bigint
);

-- =============================================================================
-- 5. A signed-out visitor cannot validate a code
-- =============================================================================

select test_result.sign_out();

select test_result.eq(
  'a signed-out visitor cannot validate a code',
  public.validate_coupon('00000000-0000-4000-8000-000000000001', 'SAVE10', 30000) ->> 'error',
  'not_logged_in'
);

-- =============================================================================
-- 6. Placing an order WITH a coupon
--    Product 1 (Tomato) at Rs 18 x 20 = Rs 360 subtotal.
-- =============================================================================

reset role;
update public.products set stock_qty = 40, is_active = true, price_paise = 1800
  where id = '20000000-0000-4000-8000-000000000001';

set role authenticated;
select test_result.sign_in('11111111-1111-1111-1111-111111111111');

do $$
declare
  v_result   jsonb;
  v_order_id uuid;
begin
  v_result := public.place_order(
    '[{"product_id":"20000000-0000-4000-8000-000000000001","quantity":20}]',
    '00000000-0000-4000-8000-000000000001',
    '50000000-0000-4000-8000-000000000001',
    'coupon-key-save10-0001',
    null,
    'SAVE10'
  );

  v_order_id := (v_result ->> 'order_id')::uuid;

  perform test_result.ok('coupon order: placed', v_result ->> 'ok' = 'true');
  perform test_result.eq('coupon: 10% of 36000 is 3600',
    (v_result ->> 'discount_paise')::bigint, 3600::bigint);
  perform test_result.eq(
    'coupon: the total is subtotal + fee - discount',
    (v_result ->> 'total_paise')::bigint,
    (v_result ->> 'subtotal_paise')::bigint
      + (v_result ->> 'delivery_fee_paise')::bigint
      - (v_result ->> 'discount_paise')::bigint
  );
  perform test_result.eq(
    'coupon: the order row carries the code',
    (select coupon_code from public.orders where id = v_order_id),
    'SAVE10'
  );
  perform test_result.eq(
    'the order row carries the discount, so history explains the total',
    (select discount_paise from public.orders where id = v_order_id),
    3600::bigint
  );
  perform test_result.ok(
    'the order totals still add up (the CHECK holds with a coupon)',
    (select (subtotal_paise + delivery_fee_paise - discount_paise) = total_paise
       from public.orders where id = v_order_id)
  );
end;
$$;

reset role;
select test_result.eq(
  'the coupon counted exactly one use',
  (select used_count from public.coupons where code = 'SAVE10'),
  1::bigint
);

select test_result.eq(
  'a flat coupon never discounts more than the basket itself',
  (select public.coupon_discount(c, 100) from public.coupons c where c.code = 'KUNIGAL50'),
  100::bigint
);

-- =============================================================================
-- 7. Replaying the same request does NOT count a second use
-- =============================================================================

set role authenticated;
select test_result.sign_in('11111111-1111-1111-1111-111111111111');

do $$
declare
  v_result jsonb;
begin
  v_result := public.place_order(
    '[{"product_id":"20000000-0000-4000-8000-000000000001","quantity":20}]',
    '00000000-0000-4000-8000-000000000001',
    '50000000-0000-4000-8000-000000000001',
    'coupon-key-save10-0001',
    null,
    'SAVE10'
  );

  perform test_result.ok('replay: the order is returned again', v_result ->> 'ok' = 'true');
  perform test_result.ok('replay: it is marked replayed', v_result ->> 'replayed' = 'true');
  perform test_result.eq(
    'replay: the same discount comes back',
    (v_result ->> 'discount_paise')::bigint,
    3600::bigint
  );
end;
$$;

reset role;
select test_result.eq(
  'a replayed order did not count a second use',
  (select used_count from public.coupons where code = 'SAVE10'),
  1::bigint
);

-- =============================================================================
-- 7b. An unknown coupon at checkout: refused, and nothing is written
-- =============================================================================

set role authenticated;
select test_result.sign_in('11111111-1111-1111-1111-111111111111');

do $$
declare
  v_result jsonb;
begin
  v_result := public.place_order(
    '[{"product_id":"20000000-0000-4000-8000-000000000001","quantity":20}]',
    '00000000-0000-4000-8000-000000000001',
    '50000000-0000-4000-8000-000000000001',
    'bad-coupon-key-0001',
    null,
    'NOPE123'
  );

  perform test_result.ok('an unknown coupon is refused', v_result ->> 'ok' = 'false');
  perform test_result.eq('an unknown coupon: the error', v_result ->> 'error', 'coupon_not_found');
end;
$$;

reset role;
select test_result.eq(
  'an unknown coupon created no order',
  (select count(*) from public.orders where idempotency_key = 'bad-coupon-key-0001'),
  0::bigint
);

-- =============================================================================
-- 8. A used-up code is refused, and re-checked even at place_order time
-- =============================================================================

reset role;
update public.coupons set usage_limit = 1, used_count = 1 where code = 'SAVE10';
set role authenticated;
select test_result.sign_in('11111111-1111-1111-1111-111111111111');

select test_result.eq(
  'a used-up code is refused by the preview',
  public.validate_coupon('00000000-0000-4000-8000-000000000001', 'SAVE10', 30000) ->> 'error',
  'coupon_used_up'
);

do $$
declare
  v_result jsonb;
begin
  v_result := public.place_order(
    '[{"product_id":"20000000-0000-4000-8000-000000000001","quantity":20}]',
    '00000000-0000-4000-8000-000000000001',
    '50000000-0000-4000-8000-000000000001',
    'used-up-key-0001',
    null,
    'SAVE10'
  );

  perform test_result.eq(
    'a used-up code is refused even at place_order time',
    v_result ->> 'error',
    'coupon_used_up'
  );
end;
$$;

-- =============================================================================
-- 9. A flat coupon larger than the basket never makes the total negative.
--    Proved directly on the one arithmetic function.
-- =============================================================================

reset role;
update public.coupons set usage_limit = null, used_count = 0 where code = 'SAVE10';

select test_result.eq(
  'a flat coupon never discounts more than the basket',
  (select public.coupon_discount(c, 100) from public.coupons c where c.code = 'KUNIGAL50'),
  100::bigint
);

-- Leave the coupons as the seed left them.
update public.coupons set used_count = 0, usage_limit = null
  where store_id = '00000000-0000-4000-8000-000000000001';
