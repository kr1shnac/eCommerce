-- =============================================================================
-- 45 · The customer is told what changed, and the shop records what it owes
-- =============================================================================
-- Migration 20261113000003 adds the shortage notice stamp, the recorded
-- partial refund and its settle door. The claims:
--
--   1. THE NOTICE: every real adjustment stamps `shortage_adjusted_at` —
--      on a paid online order AND on a cash one, because the notice is about
--      the BAG, not about the money.
--   2. THE ACCRUAL: only a paid NON-CASH order accrues the drop
--      (`old_total − new_total`) into `shortage_refund_paise`. A cash order's
--      smaller bag is simply paid for at the door (nothing owed), and an
--      online order still `pending` has paid nothing yet (nothing owed).
--   3. REPEATS: a no-op adjustment changes nothing; a second real adjustment
--      ADDS its own drop (running sum, integer paise).
--   4. THE GENERous COLUMN STAYS THE BOSS: `refund_due_paise` (generated)
--      keeps its own rule — 0 while the order is in flight, even when a
--      shortage refund is already recorded. The two ledgers do not bleed
--      into each other.
--   5. THE DOORS ARE SEPARATE: `mark_refund_paid()` still refuses a
--      DELIVERED order (only cancelled/failed/returned are owed a full
--      refund), while `mark_shortage_refund_paid()` settles on ANY status —
--      a delivered-but-smaller bag is owed its difference after a perfectly
--      good delivery.
--   6. SETTLEMENT STAMPS, NEVER ERASES: the recorded amount survives the
--      stamp, a repeat call is idempotent, and a zero recorded amount is
--      refused (P0001), as is an unknown order (P0002) and a non-admin
--      caller (42501).
--   7. CANCEL AFTER SHORTAGE: the generated column takes over the terminal
--      half (T1) while the recorded column holds the drop (T0 − T1); the
--      day's refund line carries BOTH halves — together they are exactly
--      what the customer paid, never twice — and `mark_refund_paid()`
--      settles both in one motion.
--   8. THE DAY'S BOOKS: `shop_day_totals()`'s refund line counts only the
--      UNSETTLED recorded amounts and the generated debts — a settled
--      shortage leaves the day's books the moment it is paid.
--
-- Fixture arithmetic (tomato @1800, onion @2600, delivery fee 2500):
--   b1  upi  paid     tomato 10 + onion 3   T0 28300 → 21100 → 15900  Δ 12400
--   b2  cod  paid     tomato  5 + onion 2   T0 16700 → 11300          Δ 5400 (not owed)
--   b3  upi  pending  tomato  8             T0 16900 → 11500          Δ 5400 (not owed)
--   b4  upi  paid     tomato  6 + onion 2   T0 18500 → 13100          Δ 5400 (owed, left open)
-- =============================================================================

select test_result.begin_suite('45 shortage notice and refund');

reset role;

-- The shelf is SET, not assumed: the line guard copies the price from the
-- products row, and earlier suites leave stock wherever they left it.
update public.products
   set stock_qty = 40, is_active = true, price_paise = 1800
 where id = '20000000-0000-4000-8000-000000000001';
update public.products
   set stock_qty = 60, is_active = true, price_paise = 2600
 where id = '20000000-0000-4000-8000-000000000002';

-- -----------------------------------------------------------------------------
-- 1. Four orders, inserted AS THE SIGNED-IN OWNER so `guard_order_insert`
--    leaves the payment facts alone (the fixture trick suites 26 and 34 use).
-- -----------------------------------------------------------------------------
set role authenticated;
select test_result.sign_in('33333333-3333-3333-3333-333333333333');   -- Owner

insert into public.orders (
  id, user_id, store_id, address_id, delivery_address,
  status, payment_method, payment_status,
  subtotal_paise, delivery_fee_paise, discount_paise, total_paise,
  placed_at
)
values
  ('94000000-0000-4000-8000-0000000000a1',
   '11111111-1111-1111-1111-111111111111',
   '00000000-0000-4000-8000-000000000001',
   '50000000-0000-4000-8000-000000000001',
   '{"line1":"12, Gandhi Road","pincode":"572130"}'::jsonb,
   'placed', 'upi', 'paid', 25800, 2500, 0, 28300,
   now()),
  ('94000000-0000-4000-8000-0000000000a2',
   '11111111-1111-1111-1111-111111111111',
   '00000000-0000-4000-8000-000000000001',
   '50000000-0000-4000-8000-000000000001',
   '{"line1":"12, Gandhi Road","pincode":"572130"}'::jsonb,
   'placed', 'cod', 'paid', 14200, 2500, 0, 16700,
   now()),
  ('94000000-0000-4000-8000-0000000000a3',
   '11111111-1111-1111-1111-111111111111',
   '00000000-0000-4000-8000-000000000001',
   '50000000-0000-4000-8000-000000000001',
   '{"line1":"12, Gandhi Road","pincode":"572130"}'::jsonb,
   'placed', 'upi', 'pending', 14400, 2500, 0, 16900,
   now()),
  ('94000000-0000-4000-8000-0000000000a4',
   '11111111-1111-1111-1111-111111111111',
   '00000000-0000-4000-8000-000000000001',
   '50000000-0000-4000-8000-000000000001',
   '{"line1":"12, Gandhi Road","pincode":"572130"}'::jsonb,
   'placed', 'upi', 'paid', 16000, 2500, 0, 18500,
   now());

-- The LINES go in as the table owner — no admin INSERT policy exists on
-- order_items; the definer place_order() is the normal write path (suite 41's
-- documented fixture shape: the order is the guarded thing, the lines are data).
reset role;

insert into public.order_items (
  id, order_id, product_id, product_name_en, product_name_kn,
  unit, price_paise, quantity
)
values
  ('94000000-0000-4000-8000-000000000001', '94000000-0000-4000-8000-0000000000a1',
   '20000000-0000-4000-8000-000000000001', 'Tomato', 'ಟೊಮೆಟೊ', '500 g', 1800, 10),
  ('94000000-0000-4000-8000-000000000002', '94000000-0000-4000-8000-0000000000a1',
   '20000000-0000-4000-8000-000000000002', 'Onion', 'ಈರುಳ್ಳಿ', '1 kg', 2600, 3),
  ('94000000-0000-4000-8000-000000000011', '94000000-0000-4000-8000-0000000000a2',
   '20000000-0000-4000-8000-000000000001', 'Tomato', 'ಟೊಮೆಟೊ', '500 g', 1800, 5),
  ('94000000-0000-4000-8000-000000000012', '94000000-0000-4000-8000-0000000000a2',
   '20000000-0000-4000-8000-000000000002', 'Onion', 'ಈರುಳ್ಳಿ', '1 kg', 2600, 2),
  ('94000000-0000-4000-8000-000000000021', '94000000-0000-4000-8000-0000000000a3',
   '20000000-0000-4000-8000-000000000001', 'Tomato', 'ಟೊಮೆಟೊ', '500 g', 1800, 8),
  ('94000000-0000-4000-8000-000000000031', '94000000-0000-4000-8000-0000000000a4',
   '20000000-0000-4000-8000-000000000001', 'Tomato', 'ಟೊಮೆಟೊ', '500 g', 1800, 6),
  ('94000000-0000-4000-8000-000000000032', '94000000-0000-4000-8000-0000000000a4',
   '20000000-0000-4000-8000-000000000002', 'Onion', 'ಈರುಳ್ಳಿ', '1 kg', 2600, 2);

-- Back to the owner for every adjustment, settle door and day book below.
set role authenticated;
select test_result.sign_in('33333333-3333-3333-3333-333333333333');   -- Owner

-- The day's refund line before any of this suite's adjustments — the delta
-- against it isolates THIS suite from whatever earlier suites left behind.
do $$
declare
  v_base bigint;
begin
  select (public.shop_day_totals()).refund_due_paise into v_base;
  perform set_config('test.shortage.base', v_base::text, false);
end;
$$;

-- -----------------------------------------------------------------------------
-- 2. b1 (upi, paid): the first adjustment stamps the notice and accrues the drop.
-- -----------------------------------------------------------------------------
do $$
declare
  v_order public.orders;
begin
  v_order := public.admin_adjust_order_item(
    '94000000-0000-4000-8000-0000000000a1',
    '94000000-0000-4000-8000-000000000001',
    6);

  perform test_result.eq('the order total follows the shorter line (28300 − 7200)',
    v_order.total_paise, 21100);
  perform test_result.eq('the drop is recorded as the money owed back (4 × 1800)',
    v_order.shortage_refund_paise, 7200);
  perform test_result.ok('the customer''s notice is stamped',
    v_order.shortage_adjusted_at is not null);
  perform test_result.ok('nothing is settled yet',
    v_order.shortage_refund_paid_at is null);
  perform test_result.eq('the generated refund column stays out of it while the order is live',
    v_order.refund_due_paise, 0);
end;
$$;

-- -----------------------------------------------------------------------------
-- 3. A no-op adjustment changes nothing — not the amount, not the stamp.
-- -----------------------------------------------------------------------------
do $$
declare
  v_order public.orders;
  v_stamp timestamptz;
begin
  select shortage_adjusted_at into v_stamp
    from public.orders
   where id = '94000000-0000-4000-8000-0000000000a1';

  v_order := public.admin_adjust_order_item(
    '94000000-0000-4000-8000-0000000000a1',
    '94000000-0000-4000-8000-000000000001',
    6);

  perform test_result.ok('a repeat of the same quantity is a safe retry, not a second stamp',
    v_order.shortage_adjusted_at = v_stamp);
  perform test_result.eq('and no second drop is recorded',
    v_order.shortage_refund_paise, 7200);
end;
$$;

-- -----------------------------------------------------------------------------
-- 4. The second real adjustment ADDS its own drop.
-- -----------------------------------------------------------------------------
do $$
declare
  v_order public.orders;
begin
  v_order := public.admin_adjust_order_item(
    '94000000-0000-4000-8000-0000000000a1',
    '94000000-0000-4000-8000-000000000002',
    1);

  perform test_result.eq('the running sum carries both drops (7200 + 2 × 2600)',
    v_order.shortage_refund_paise, 12400);
  perform test_result.eq('and the total now says what the shelf can actually give',
    v_order.total_paise, 15900);
end;
$$;

-- -----------------------------------------------------------------------------
-- 5. b2 (cod, PAID): the smaller bag is paid for in cash at the door.
--    The notice is still stamped — the customer must be told regardless.
-- -----------------------------------------------------------------------------
do $$
declare
  v_order public.orders;
begin
  v_order := public.admin_adjust_order_item(
    '94000000-0000-4000-8000-0000000000a2',
    '94000000-0000-4000-8000-000000000011',
    2);

  perform test_result.eq('a cash order owes nothing back, even a paid one',
    v_order.shortage_refund_paise, 0);
  perform test_result.ok('but its customer is told the bag changed too',
    v_order.shortage_adjusted_at is not null);
  perform test_result.eq('and the total still follows the line',
    v_order.total_paise, 11300);
end;
$$;

-- -----------------------------------------------------------------------------
-- 6. b3 (upi, PENDING): paid nothing yet, so nothing is owed.
-- -----------------------------------------------------------------------------
do $$
declare
  v_order public.orders;
begin
  v_order := public.admin_adjust_order_item(
    '94000000-0000-4000-8000-0000000000a3',
    '94000000-0000-4000-8000-000000000021',
    5);

  perform test_result.eq('an unpaid online order owes nothing back',
    v_order.shortage_refund_paise, 0);
  perform test_result.ok('and its customer is told as well',
    v_order.shortage_adjusted_at is not null);
end;
$$;

-- -----------------------------------------------------------------------------
-- 7. b1 is delivered by the honest path — the shortage refund survives the
--    delivery, and the FULL-refund door still refuses a delivered order.
-- -----------------------------------------------------------------------------
select public.admin_force_complete('94000000-0000-4000-8000-0000000000a1');

select test_result.ok(
  'a delivered order still carries the recorded shortage (the bag came smaller)',
  (select shortage_refund_paise from public.orders
    where id = '94000000-0000-4000-8000-0000000000a1') = 12400
  and (select status from public.orders
         where id = '94000000-0000-4000-8000-0000000000a1') = 'delivered');

select test_result.refused(
  'the full-refund door refuses a delivered order — that is WHY the shortage door exists',
  $$ select public.mark_refund_paid('94000000-0000-4000-8000-0000000000a1') $$,
  'P0001'
);

-- -----------------------------------------------------------------------------
-- 8. The shortage door settles it on a DELIVERED order, stamps without
--    erasing, and a repeat call is a safe retry.
-- -----------------------------------------------------------------------------
do $$
declare
  v_order public.orders;
  v_stamp timestamptz;
begin
  v_order := public.mark_shortage_refund_paid('94000000-0000-4000-8000-0000000000a1');

  perform test_result.ok('the shortage door works on any status — delivered included',
    v_order.shortage_refund_paid_at is not null);
  perform test_result.eq('and the record stays after settlement — an audit trail, not a vanish',
    v_order.shortage_refund_paise, 12400);

  v_stamp := v_order.shortage_refund_paid_at;

  v_order := public.mark_shortage_refund_paid('94000000-0000-4000-8000-0000000000a1');

  perform test_result.ok('a repeat call returns the row with the stamp unchanged',
    v_order.shortage_refund_paid_at = v_stamp);
end;
$$;

-- -----------------------------------------------------------------------------
-- 9. b4 (upi, PAID) is adjusted and left OPEN — it is the day's unsettled
--    liability for the books check that follows.
-- -----------------------------------------------------------------------------
do $$
declare
  v_order public.orders;
begin
  v_order := public.admin_adjust_order_item(
    '94000000-0000-4000-8000-0000000000a4',
    '94000000-0000-4000-8000-000000000031',
    3);

  perform test_result.eq('the open order''s total follows the shorter line (18500 − 5400)',
    v_order.total_paise, 13100);
  perform test_result.eq('and its drop is recorded as owed (3 × 1800)',
    v_order.shortage_refund_paise, 5400);
end;
$$;

-- -----------------------------------------------------------------------------
-- 10. The day's refund line: only the UNSETTLED recorded amount counts
--     (b4's 5400), plus whatever generated debts exist. b1's settled 12400
--     has left the books; b2 and b3 owe nothing.
-- -----------------------------------------------------------------------------
do $$
declare
  v_base  bigint;
  v_now   bigint;
begin
  v_base := (current_setting('test.shortage.base'))::bigint;
  select (public.shop_day_totals()).refund_due_paise into v_now;

  perform test_result.eq('the day''s refund line counts only what is still owed (delta = b4''s 5400)',
    v_now - v_base, 5400);
end;
$$;

-- -----------------------------------------------------------------------------
-- 10. Cancel after shortage: the two halves of one truth.
--     The generated column takes the terminal half (the reduced total),
--     the recorded column keeps the drop — together exactly T0, the money
--     the customer actually paid, counted once each.
-- -----------------------------------------------------------------------------
select public.admin_cancel_order(
  '94000000-0000-4000-8000-0000000000a4',
  'customer asked by phone'
);

select test_result.eq(
  'the cancelled order''s generated debt is its reduced total (T1 = 13100)',
  (select refund_due_paise from public.orders
    where id = '94000000-0000-4000-8000-0000000000a4'),
  13100
);
select test_result.eq(
  'and the recorded shortage keeps the drop (T0 − T1 = 5400)',
  (select shortage_refund_paise from public.orders
    where id = '94000000-0000-4000-8000-0000000000a4'),
  5400
);

do $$
declare
  v_base bigint;
  v_now  bigint;
begin
  v_base := (current_setting('test.shortage.base'))::bigint;
  select (public.shop_day_totals()).refund_due_paise into v_now;

  perform test_result.eq(
    'the day''s line now carries both halves — exactly what the customer paid (13100 + 5400)',
    v_now - v_base, 18500);
end;
$$;

-- -----------------------------------------------------------------------------
-- 11. The full-refund door settles BOTH halves in one motion.
-- -----------------------------------------------------------------------------
do $$
declare
  v_order public.orders;
  v_stamp timestamptz;
begin
  v_order := public.mark_refund_paid('94000000-0000-4000-8000-0000000000a4');

  perform test_result.ok('the shortage half is stamped settled by the full refund',
    v_order.shortage_refund_paid_at is not null);
  perform test_result.eq('the record still stays',
    v_order.shortage_refund_paise, 5400);
  perform test_result.eq('the generated debt is cleared by the refund',
    v_order.refund_due_paise, 0);

  v_stamp := v_order.shortage_refund_paid_at;

  v_order := public.mark_refund_paid('94000000-0000-4000-8000-0000000000a4');

  perform test_result.ok('a repeat call is a safe retry, not a second stamp',
    v_order.shortage_refund_paid_at = v_stamp);
end;
$$;

do $$
declare
  v_base bigint;
  v_now  bigint;
begin
  v_base := (current_setting('test.shortage.base'))::bigint;
  select (public.shop_day_totals()).refund_due_paise into v_now;

  perform test_result.eq('settling leaves the day''s refund line empty again (delta = 0)',
    v_now - v_base, 0);
end;
$$;

-- -----------------------------------------------------------------------------
-- 12. The refusals: nothing recorded, unknown order, and non-admin callers.
-- -----------------------------------------------------------------------------
select test_result.refused(
  'the shortage door refuses an order with nothing recorded',
  $$ select public.mark_shortage_refund_paid('94000000-0000-4000-8000-0000000000a2') $$,
  'P0001'
);

select test_result.refused(
  'the shortage door refuses an unknown order',
  $$ select public.mark_shortage_refund_paid(
       '94000000-0000-4000-8000-00000000dead') $$,
  'P0002'
);

select test_result.sign_out();
select test_result.sign_in('11111111-1111-1111-1111-111111111111');   -- Asha

select test_result.refused(
  'a customer cannot mark a shortage refund paid',
  $$ select public.mark_shortage_refund_paid('94000000-0000-4000-8000-0000000000a1') $$,
  '42501'
);
select test_result.refused(
  'a customer cannot mark a full refund paid either',
  $$ select public.mark_refund_paid('94000000-0000-4000-8000-0000000000a4') $$,
  '42501'
);

-- -----------------------------------------------------------------------------
-- 13. Put the fixtures back.
-- -----------------------------------------------------------------------------
select test_result.sign_out();
reset role;

delete from public.order_items
  where order_id::text like '94000000-%';
delete from public.orders
  where id::text like '94000000-%';

-- The adjustments put released units back and the cancel put b4's lines
-- back; the absolute restore resets every fiction at once.
update public.products
   set stock_qty = 40, is_active = true, price_paise = 1800
 where id = '20000000-0000-4000-8000-000000000001';
update public.products
   set stock_qty = 60, is_active = true, price_paise = 2600
 where id = '20000000-0000-4000-8000-000000000002';

select test_result.eq(
  'fixture restored: 40 tomatoes again',
  (select stock_qty from public.products
    where id = '20000000-0000-4000-8000-000000000001'),
  40
);
select test_result.eq(
  'fixture restored: 60 onions again',
  (select stock_qty from public.products
    where id = '20000000-0000-4000-8000-000000000002'),
  60
);
