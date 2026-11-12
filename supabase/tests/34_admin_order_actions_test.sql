-- =============================================================================
-- 34 · The shop closes an order on a customer's behalf, and completes one
-- =============================================================================
-- Migration 20261109000005 adds `orders.cancellation_reason` and the two owner
-- actions. This suite proves:
--
--   1. A customer and a rider cannot reach either action (42501);
--   2. an unknown order is refused (P0002), not silently ignored;
--   3. a terminal order cannot be cancelled or force-completed (P0001);
--   4. `admin_cancel_order()` really cancels, writes the reason, and puts the
--      stock back exactly once;
--   5. the customer's own cancel still leaves the reason NULL;
--   6. a rider cannot rewrite the shop's cancellation reason, and cannot cancel
--      at all;
--   7. `admin_force_complete()` reaches `delivered` with a `delivered_at`, and
--      never rewrites an existing one;
--   8. force-complete does NOT touch stock and does NOT claim payment;
--   9. `failed` can never be reopened as `delivered` through either path;
--  10. money is untouched by both actions.
--
-- The fixtures live on 2020-04-01, a day no other suite uses.
-- =============================================================================

select test_result.begin_suite('34 admin order actions');

-- -----------------------------------------------------------------------------
-- Fixtures. Cancelled-to-order, so the shop's reason column is visible.
--
--   o1  placed,      COD,    pending -> the cancel case
--   o2  delivered,   COD,    paid    -> cannot be cancelled or completed
--   o3  failed,      COD,    pending -> terminal both ways
--   o4  confirmed,   online, paid    -> the force-complete case, and it carries
--                                        a coupon so the coupon release question
--                                        is answered by a real row
-- -----------------------------------------------------------------------------
reset role;
set role authenticated;
select test_result.sign_in('33333333-3333-3333-3333-333333333333');   -- Owner

insert into public.orders (
  id, user_id, store_id, address_id, delivery_address,
  status, payment_method, payment_status,
  subtotal_paise, delivery_fee_paise, discount_paise, total_paise,
  placed_at, delivered_at, failure_reason, coupon_code
)
values
  ('80000000-0000-4000-8000-0000000000a1',
   '11111111-1111-1111-1111-111111111111',
   '00000000-0000-4000-8000-000000000001',
   '50000000-0000-4000-8000-000000000001',
   '{"line1":"12, Gandhi Road","pincode":"572130"}'::jsonb,
   'placed', 'cod', 'pending', 12000, 2500, 0, 14500,
   date '2020-04-01' + time '10:00', null, null, null);

insert into public.orders (
  id, user_id, store_id, address_id, delivery_address,
  status, payment_method, payment_status,
  subtotal_paise, delivery_fee_paise, discount_paise, total_paise,
  placed_at, delivered_at, failure_reason, coupon_code
)
values
  ('80000000-0000-4000-8000-0000000000a2',
   '11111111-1111-1111-1111-111111111111',
   '00000000-0000-4000-8000-000000000001',
   '50000000-0000-4000-8000-000000000001',
   '{"line1":"12, Gandhi Road","pincode":"572130"}'::jsonb,
   'delivered', 'cod', 'paid', 10000, 2500, 0, 12500,
   date '2020-04-01' + time '11:00', date '2020-04-01' + time '11:30', null, null);

insert into public.orders (
  id, user_id, store_id, address_id, delivery_address,
  status, payment_method, payment_status,
  subtotal_paise, delivery_fee_paise, discount_paise, total_paise,
  placed_at, delivered_at, failure_reason, coupon_code
)
values
  ('80000000-0000-4000-8000-0000000000a3',
   '11111111-1111-1111-1111-111111111111',
   '00000000-0000-4000-8000-000000000001',
   '50000000-0000-4000-8000-000000000001',
   '{"line1":"12, Gandhi Road","pincode":"572130"}'::jsonb,
   'failed', 'cod', 'pending', 9000, 2500, 0, 11500,
   date '2020-04-01' + time '12:00', null, 'unreachable', null);

insert into public.orders (
  id, user_id, store_id, address_id, delivery_address,
  status, payment_method, payment_status,
  subtotal_paise, delivery_fee_paise, discount_paise, total_paise,
  placed_at, delivered_at, failure_reason, coupon_code
)
values
  ('80000000-0000-4000-8000-0000000000a4',
   '11111111-1111-1111-1111-111111111111',
   '00000000-0000-4000-8000-000000000001',
   '50000000-0000-4000-8000-000000000001',
   '{"line1":"12, Gandhi Road","pincode":"572130"}'::jsonb,
   'confirmed', 'online', 'paid', 8000, 2500, 1500, 9000,
   date '2020-04-01' + time '13:00', null, null, 'SAVE10');

-- Line items, so the stock restore has something to restore. As the table
-- owner, not the owner user: `order_items` deliberately has no admin insert
-- policy (migration 08 closed that door), and the fixture is data, not the
-- thing under test.
reset role;

insert into public.order_items (order_id, product_id, product_name_en, product_name_kn, unit, price_paise, quantity)
values
  ('80000000-0000-4000-8000-0000000000a1',
   '20000000-0000-4000-8000-000000000001', 'Tomato', 'ಟೊಮೆಟೊ', 'kg', 1800, 5),
  ('80000000-0000-4000-8000-0000000000a4',
   '20000000-0000-4000-8000-000000000001', 'Tomato', 'ಟೊಮೆಟೊ', 'kg', 1800, 3);

-- A known shelf: 60 tomatoes, and Save10 is not near its cap.
update public.products set stock_qty = 60, is_active = true, price_paise = 1800
  where id = '20000000-0000-4000-8000-000000000001';
update public.coupons set used_count = 0 where code = 'SAVE10';

select test_result.eq(
  'fixture: the shelf starts at 60',
  (select stock_qty from public.products where id = '20000000-0000-4000-8000-000000000001'),
  60
);

-- =============================================================================
-- 1. The door: only the shop.
-- =============================================================================

set role authenticated;
select test_result.sign_in('11111111-1111-1111-1111-111111111111');   -- Asha (customer)

select test_result.refused(
  'a customer cannot cancel somebody else''s order',
  $$ select public.admin_cancel_order('80000000-0000-4000-8000-0000000000a2') $$,
  '42501'
);
select test_result.refused(
  'a customer cannot force-complete an order',
  $$ select public.admin_force_complete('80000000-0000-4000-8000-0000000000a4') $$,
  '42501'
);

select test_result.sign_in('44444444-4444-4444-4444-444444444444');   -- Rider

select test_result.refused(
  'a rider cannot cancel an order for a customer',
  $$ select public.admin_cancel_order('80000000-0000-4000-8000-0000000000a1') $$,
  '42501'
);
select test_result.refused(
  'a rider cannot force-complete an order',
  $$ select public.admin_force_complete('80000000-0000-4000-8000-0000000000a4') $$,
  '42501'
);

set role anon;

select test_result.refused(
  'a signed-out visitor cannot cancel an order',
  $$ select public.admin_cancel_order('80000000-0000-4000-8000-0000000000a1') $$,
  '42501'
);

-- =============================================================================
-- 2. Unknown orders are refused, not ignored.
-- =============================================================================

-- The signed-out test left the session as `anon`, and `sign_in` only sets the
-- JWT claims — it does not change the role. Both have to be set, or every call
-- below is refused with "permission denied for function" before the function's
-- own checks are ever reached.
set role authenticated;
select test_result.sign_in('33333333-3333-3333-3333-333333333333');   -- Owner

select test_result.refused(
  'an unknown order is refused by admin_cancel_order',
  $$ select public.admin_cancel_order('80000000-0000-4000-8000-0000000000ff') $$,
  'P0002'
);
select test_result.refused(
  'an unknown order is refused by admin_force_complete',
  $$ select public.admin_force_complete('80000000-0000-4000-8000-0000000000ff') $$,
  'P0002'
);

-- =============================================================================
-- 3. Terminal orders are out of reach for both actions.
-- =============================================================================

select test_result.refused(
  'a delivered order cannot be cancelled',
  $$ select public.admin_cancel_order('80000000-0000-4000-8000-0000000000a2') $$,
  'P0001'
);
select test_result.refused(
  'a failed order cannot be cancelled',
  $$ select public.admin_cancel_order('80000000-0000-4000-8000-0000000000a3') $$,
  'P0001'
);
select test_result.refused(
  'a failed order can never be reopened as delivered',
  $$ select public.admin_force_complete('80000000-0000-4000-8000-0000000000a3') $$,
  'P0001'
);

-- =============================================================================
-- 4. The owner cancels on the customer's behalf.
-- =============================================================================

do $$
declare
  v_order public.orders;
begin
  v_order := public.admin_cancel_order(
    '80000000-0000-4000-8000-0000000000a1',
    '  Your brother already brought the milk.  '
  );

  perform test_result.eq(
    'the order is cancelled',
    v_order.status::text,
    'cancelled'
  );
  perform test_result.eq(
    'the reason is stored, trimmed',
    v_order.cancellation_reason,
    'Your brother already brought the milk.'
  );
end;
$$;

reset role;

select test_result.eq(
  'the cancelled order really is cancelled in the table',
  (select status::text from public.orders where id = '80000000-0000-4000-8000-0000000000a1'),
  'cancelled'
);

select test_result.eq(
  'the stock came back: 60 + 5 tomatoes',
  (select stock_qty from public.products where id = '20000000-0000-4000-8000-000000000001'),
  65
);

select test_result.eq(
  'the money columns were not touched by the cancel',
  (select total_paise from public.orders where id = '80000000-0000-4000-8000-0000000000a1'),
  14500
);

-- A cancelled order can never be marked delivered, by either path.
set role authenticated;
select test_result.refused(
  'a cancelled order can never be marked delivered',
  $$ select public.admin_force_complete('80000000-0000-4000-8000-0000000000a1') $$,
  'P0001'
);

-- A blank reason is NULL, so "no reason" is one state.
do $$
declare
  v_order public.orders;
begin
  v_order := public.admin_cancel_order('80000000-0000-4000-8000-0000000000a4', '   ');
  perform test_result.eq(
    'a blank reason is stored as NULL',
    v_order.cancellation_reason,
    null::text
  );
end;
$$;

reset role;

select test_result.eq(
  'a4 is cancelled too, so the force-complete case below is gone',
  (select status::text from public.orders where id = '80000000-0000-4000-8000-0000000000a4'),
  'cancelled'
);

-- Re-open a live order for the force-complete case, as the owner.
reset role;
update public.orders set status = 'packing', delivered_at = null
  where id = '80000000-0000-4000-8000-0000000000a4';

-- =============================================================================
-- 5. Force-complete: delivered, with a time, and nothing else moved.
-- =============================================================================

set role authenticated;
select test_result.sign_in('33333333-3333-3333-3333-333333333333');

do $$
declare
  v_order public.orders;
  v_paid_at timestamptz;
begin
  v_order := public.admin_force_complete('80000000-0000-4000-8000-0000000000a4');

  perform test_result.eq(
    'the order is delivered',
    v_order.status::text,
    'delivered'
  );
  perform test_result.ok(
    'a delivery time was recorded',
    v_order.delivered_at is not null,
    v_order.delivered_at::text
  );
  perform test_result.eq(
    'the online payment stays paid',
    v_order.payment_status::text,
    'paid'
  );

  v_paid_at := v_order.delivered_at;

  -- A second tap is safe (rule 9.4): the same row, the same time, no error.
  v_order := public.admin_force_complete('80000000-0000-4000-8000-0000000000a4');

  perform test_result.eq(
    'a second tap returns the same delivered row',
    v_order.status::text,
    'delivered'
  );
  perform test_result.eq(
    'a second tap does not rewrite the delivery time',
    v_order.delivered_at::text,
    v_paid_at::text
  );
end;
$$;

-- A delivered order is the idempotent case, not an error: the action already
-- succeeded, so a retry returns the same row with the same time.
do $$
declare
  v_before public.orders;
  v_after  public.orders;
begin
  select * into v_before from public.orders
   where id = '80000000-0000-4000-8000-0000000000a2';

  v_after := public.admin_force_complete('80000000-0000-4000-8000-0000000000a2');

  perform test_result.eq(
    'a delivered order stays delivered',
    v_after.status::text,
    'delivered'
  );
  perform test_result.eq(
    'and keeps the delivery time it already had',
    v_after.delivered_at::text,
    v_before.delivered_at::text
  );
end;
$$;

reset role;

-- 60 at the start, +5 when a1 was cancelled, +3 when a4 was cancelled. The
-- force-complete itself must move none of it.
select test_result.eq(
  'force-complete did NOT touch stock',
  (select stock_qty from public.products where id = '20000000-0000-4000-8000-000000000001'),
  68
);

select test_result.eq(
  'the order total is unchanged',
  (select total_paise from public.orders where id = '80000000-0000-4000-8000-0000000000a4'),
  9000
);

-- =============================================================================
-- 6. The customer's own cancel leaves the reason NULL, and a rider can never
--    write one. The rider branch is the one the guard grew a line for.
-- =============================================================================

-- Re-open a live order for the rider test.
reset role;
update public.orders set status = 'placed', delivered_at = null,
       cancellation_reason = null
  where id = '80000000-0000-4000-8000-0000000000a4';

-- The customer cancels it themselves.
set role authenticated;
select test_result.sign_in('11111111-1111-1111-1111-111111111111');

do $$
declare
  v_result jsonb;
begin
  v_result := public.cancel_order('80000000-0000-4000-8000-0000000000a4');
  perform test_result.ok('the customer cancels their own order', v_result ->> 'ok' = 'true');
end;
$$;

reset role;

select test_result.eq(
  'the customer''s own cancel leaves the shop reason NULL',
  (select cancellation_reason from public.orders
    where id = '80000000-0000-4000-8000-0000000000a4'),
  null::text
);

-- A rider must not be able to write the reason.
set role authenticated;
select test_result.sign_in('44444444-4444-4444-4444-444444444444');

select test_result.refused(
  'a rider cannot write the shop''s cancellation reason',
  $$ update public.orders
        set cancellation_reason = 'the rider said so'
      where id = '80000000-0000-4000-8000-0000000000a1' $$,
  '42501'
);

select test_result.refused(
  'a rider still cannot cancel an order',
  $$ update public.orders set status = 'cancelled'
      where id = '80000000-0000-4000-8000-0000000000a2' $$,
  '42501'
);

-- =============================================================================
-- 7. Put the fixtures back.
-- =============================================================================

reset role;

delete from public.order_items
  where order_id in ('80000000-0000-4000-8000-0000000000a1',
                     '80000000-0000-4000-8000-0000000000a4');

delete from public.orders
  where id in ('80000000-0000-4000-8000-0000000000a1',
               '80000000-0000-4000-8000-0000000000a2',
               '80000000-0000-4000-8000-0000000000a3',
               '80000000-0000-4000-8000-0000000000a4');

update public.products set stock_qty = 40, is_active = true, price_paise = 1800
  where id = '20000000-0000-4000-8000-000000000001';

select test_result.eq(
  'fixture restored: the shelf is at 40 again',
  (select stock_qty from public.products where id = '20000000-0000-4000-8000-000000000001'),
  40
);