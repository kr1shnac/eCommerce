-- =============================================================================
-- 32 · The money desk: settling cash and refunds
--
-- `shop_day_totals()` reports two numbers the owner must be able to clear:
-- cash in a rider's pocket, and money owed back. Migration 20261109000003 adds
-- the two functions. This suite proves:
--
--   1. a customer and a rider cannot settle either number (42501);
--   2. the owner CAN mark a delivered COD order's cash collected, and the day's
--      books move exactly that amount from in-hand to collected;
--   3. a second call is safe and moves nothing twice (rule 9.4);
--   4. cash cannot be "collected" on an undelivered order or an online order;
--   5. the owner CAN record a refund on a cancelled online-paid order, and the
--      day's refund liability falls to zero;
--   6. a refund cannot be recorded on a delivered order, or one where no money
--      was taken;
--   7. an unknown order is refused, not silently ignored;
--   8. a customer's direct UPDATE of payment_status still touches zero rows.
--
-- The fixtures live on 2020-02-21, a day no other suite uses (test 19 owns
-- 2020-01-15, test 26 owns 2020-02-20), so the totals below cannot depend on
-- what another test left behind.
-- =============================================================================

select test_result.begin_suite('32 money desk');

-- -----------------------------------------------------------------------------
-- Fixtures, written as the shop owner (the guard lets an admin insert any state).
--
--   c1  delivered, COD,    pending  -> 10000  cash in hand
--   c2  delivered, COD,    paid     ->  4000  already collected
--   c3  delivered, online, paid     ->  6000  no cash to collect
--   c4  cancelled, online, paid     ->  7000  the refund case
--   c5  delivered, online, paid     ->  5000  not a refund case
--   c6  cancelled, online, pending  ->  3000  no money was taken
--   c7  placed,    COD,    pending  ->  9000  not delivered yet
-- -----------------------------------------------------------------------------

reset role;
set role authenticated;
select test_result.sign_in('33333333-3333-3333-3333-333333333333');

insert into public.orders (
  id, user_id, store_id, address_id, delivery_address,
  status, payment_method, payment_status,
  subtotal_paise, delivery_fee_paise, discount_paise, total_paise,
  placed_at, delivered_at, failure_reason
)
values
  ('70000000-0000-4000-8000-0000000000c1',
   '11111111-1111-1111-1111-111111111111',
   '00000000-0000-4000-8000-000000000001',
   '50000000-0000-4000-8000-000000000001',
   '{"line1":"12, Gandhi Road","pincode":"572130"}'::jsonb,
   'delivered', 'cod', 'pending', 10000, 0, 0, 10000,
   date '2020-02-21' + time '10:00', date '2020-02-21' + time '10:30', null),

  ('70000000-0000-4000-8000-0000000000c2',
   '11111111-1111-1111-1111-111111111111',
   '00000000-0000-4000-8000-000000000001',
   '50000000-0000-4000-8000-000000000001',
   '{"line1":"12, Gandhi Road","pincode":"572130"}'::jsonb,
   'delivered', 'cod', 'paid', 4000, 0, 0, 4000,
   date '2020-02-21' + time '11:00', date '2020-02-21' + time '11:30', null),

  ('70000000-0000-4000-8000-0000000000c3',
   '11111111-1111-1111-1111-111111111111',
   '00000000-0000-4000-8000-000000000001',
   '50000000-0000-4000-8000-000000000001',
   '{"line1":"12, Gandhi Road","pincode":"572130"}'::jsonb,
   'delivered', 'online', 'paid', 6000, 0, 0, 6000,
   date '2020-02-21' + time '12:00', date '2020-02-21' + time '12:30', null),

  ('70000000-0000-4000-8000-0000000000c4',
   '11111111-1111-1111-1111-111111111111',
   '00000000-0000-4000-8000-000000000001',
   '50000000-0000-4000-8000-000000000001',
   '{"line1":"12, Gandhi Road","pincode":"572130"}'::jsonb,
   'cancelled', 'online', 'paid', 7000, 0, 0, 7000,
   date '2020-02-21' + time '13:00', null, null),

  ('70000000-0000-4000-8000-0000000000c5',
   '11111111-1111-1111-1111-111111111111',
   '00000000-0000-4000-8000-000000000001',
   '50000000-0000-4000-8000-000000000001',
   '{"line1":"12, Gandhi Road","pincode":"572130"}'::jsonb,
   'delivered', 'online', 'paid', 5000, 0, 0, 5000,
   date '2020-02-21' + time '14:00', date '2020-02-21' + time '14:30', null),

  ('70000000-0000-4000-8000-0000000000c6',
   '11111111-1111-1111-1111-111111111111',
   '00000000-0000-4000-8000-000000000001',
   '50000000-0000-4000-8000-000000000001',
   '{"line1":"12, Gandhi Road","pincode":"572130"}'::jsonb,
   'cancelled', 'online', 'pending', 3000, 0, 0, 3000,
   date '2020-02-21' + time '15:00', null, null),

  ('70000000-0000-4000-8000-0000000000c7',
   '11111111-1111-1111-1111-111111111111',
   '00000000-0000-4000-8000-000000000001',
   '50000000-0000-4000-8000-000000000001',
   '{"line1":"12, Gandhi Road","pincode":"572130"}'::jsonb,
   'placed', 'cod', 'pending', 9000, 0, 0, 9000,
   date '2020-02-21' + time '16:00', null, null);

-- The starting books. 10000 in hand, 4000 collected, 7000 owed back.
select test_result.eq(
  'before: cash in hand is the undelivered COD money',
  (public.shop_day_totals('2020-02-21')).cash_in_hand_paise,
  10000
);
select test_result.eq(
  'before: cash collected is the COD money already handed in',
  (public.shop_day_totals('2020-02-21')).cash_collected_paise,
  4000
);
select test_result.eq(
  'before: the refund liability is the cancelled online-paid order',
  (public.shop_day_totals('2020-02-21')).refund_due_paise,
  7000
);

-- =============================================================================
-- 1. The door: only the shop settles money.
-- =============================================================================

select test_result.sign_in('11111111-1111-1111-1111-111111111111');   -- Asha

select test_result.refused(
  'a customer cannot mark cash collected',
  $$ select public.mark_cod_collected('70000000-0000-4000-8000-0000000000c1') $$,
  '42501'
);
select test_result.refused(
  'a customer cannot record a refund',
  $$ select public.mark_refund_paid('70000000-0000-4000-8000-0000000000c4') $$,
  '42501'
);

select test_result.sign_in('44444444-4444-4444-4444-444444444444');   -- Rider

select test_result.refused(
  'a rider cannot mark their own cash as collected',
  $$ select public.mark_cod_collected('70000000-0000-4000-8000-0000000000c1') $$,
  '42501'
);
select test_result.refused(
  'a rider cannot record a refund',
  $$ select public.mark_refund_paid('70000000-0000-4000-8000-0000000000c4') $$,
  '42501'
);

-- =============================================================================
-- 2. The owner settles the cash, and the day moves exactly that amount.
-- =============================================================================

select test_result.sign_in('33333333-3333-3333-3333-333333333333');

do $$
declare
  v_order public.orders;
begin
  v_order := public.mark_cod_collected('70000000-0000-4000-8000-0000000000c1');

  perform test_result.eq(
    'the owner marks c1 cash collected, and the row says paid',
    v_order.payment_status::text,
    'paid'
  );
end;
$$;

select test_result.eq(
  'after: nothing is left in hand',
  (public.shop_day_totals('2020-02-21')).cash_in_hand_paise,
  0
);
select test_result.eq(
  'after: collected is now 4000 + 10000',
  (public.shop_day_totals('2020-02-21')).cash_collected_paise,
  14000
);

-- A second tap is safe: same row, same books.
do $$
declare
  v_order public.orders;
begin
  v_order := public.mark_cod_collected('70000000-0000-4000-8000-0000000000c1');

  perform test_result.eq(
    'a second tap returns the same paid row',
    v_order.payment_status::text,
    'paid'
  );
end;
$$;

select test_result.eq(
  'a second tap did not count the cash twice',
  (public.shop_day_totals('2020-02-21')).cash_collected_paise,
  14000
);

-- =============================================================================
-- 3. Cash cannot be collected where there is no delivered cash.
-- =============================================================================

select test_result.refused(
  'cash cannot be collected before delivery',
  $$ select public.mark_cod_collected('70000000-0000-4000-8000-0000000000c7') $$,
  'P0001'
);
select test_result.refused(
  'an online order has no cash to collect',
  $$ select public.mark_cod_collected('70000000-0000-4000-8000-0000000000c3') $$,
  'P0001'
);
select test_result.refused(
  'an unknown order is refused, not ignored',
  $$ select public.mark_cod_collected('70000000-0000-4000-8000-0000000000ff') $$,
  'P0002'
);

-- An already-collected order returns unchanged (the c2 fixture).
do $$
declare
  v_order public.orders;
begin
  v_order := public.mark_cod_collected('70000000-0000-4000-8000-0000000000c2');

  perform test_result.eq(
    'an already-collected order returns paid, unchanged',
    v_order.payment_status::text,
    'paid'
  );
end;
$$;

-- =============================================================================
-- 4. The owner records the refund, and the liability clears.
-- =============================================================================

do $$
declare
  v_order public.orders;
begin
  v_order := public.mark_refund_paid('70000000-0000-4000-8000-0000000000c4');

  perform test_result.eq(
    'the owner records the refund, and the row says refunded',
    v_order.payment_status::text,
    'refunded'
  );
  perform test_result.eq(
    'the order itself now owes nothing',
    v_order.refund_due_paise,
    0::bigint
  );
end;
$$;

select test_result.eq(
  'after: the day owes nothing back',
  (public.shop_day_totals('2020-02-21')).refund_due_paise,
  0
);

-- A second tap is safe.
do $$
declare
  v_order public.orders;
begin
  v_order := public.mark_refund_paid('70000000-0000-4000-8000-0000000000c4');

  perform test_result.eq(
    'a second refund tap returns the same refunded row',
    v_order.payment_status::text,
    'refunded'
  );
end;
$$;

-- =============================================================================
-- 5. A refund cannot be recorded where none is owed.
-- =============================================================================

select test_result.refused(
  'a delivered order is not a refund case',
  $$ select public.mark_refund_paid('70000000-0000-4000-8000-0000000000c5') $$,
  'P0001'
);
select test_result.refused(
  'an order where no money was taken has nothing to refund',
  $$ select public.mark_refund_paid('70000000-0000-4000-8000-0000000000c6') $$,
  'P0001'
);
select test_result.refused(
  'a COD order has nothing to refund',
  $$ select public.mark_refund_paid('70000000-0000-4000-8000-0000000000c2') $$,
  'P0001'
);
select test_result.refused(
  'an unknown order is refused for refunds too',
  $$ select public.mark_refund_paid('70000000-0000-4000-8000-0000000000ff') $$,
  'P0002'
);

-- =============================================================================
-- 6. The silent path the functions replace.
-- =============================================================================

select test_result.sign_in('11111111-1111-1111-1111-111111111111');

select test_result.touches(
  'a customer''s direct update of payment_status touches zero rows',
  $$ update public.orders set payment_status = 'refunded'
      where id = '70000000-0000-4000-8000-0000000000c2' $$,
  0
);
