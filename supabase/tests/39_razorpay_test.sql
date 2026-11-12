-- =============================================================================
-- 39 · Razorpay: one payable object per basket, one way to settle it
--
-- The shop wants every method selectable, confirmed automatically, the way
-- Blinkit and Zepto do it. Migration 20261112000006 adds the two facts that
-- make that honest: WHICH gateway object belongs to the order, and the only
-- door that may turn money into `paid`.
--
-- This suite proves:
--
--   1. a payment intent belongs to the order's own customer, only while the
--      order is still placed and unpaid, and only for an online method;
--   2. the same gateway id twice is a safe retry, a DIFFERENT id is refused
--      (23505) because two payable objects for one basket is a double charge;
--   3. the id must look like a Razorpay order id, so a typo cannot be stored;
--   4. recording an intent never marks the order paid;
--   5. only service_role (the Edge Function that verified the signature) or an
--      admin may settle, and only with a reference shaped like a payment id;
--   6. settling twice with the same reference is safe, a second different
--      reference raises, and a verified capture on a cancelled order is
--      recorded — the money is real and becomes a refund liability;
--   7. a customer's direct UPDATE of the provider columns touches zero rows,
--      and even a forged transaction flag cannot change a total or a status;
--   8. settled money reaches the refund liability the customer is shown.
--
-- The fixtures are written as the shop owner, the way test 32 does it, so this
-- suite does not depend on stock, coupons or the shop being open.
-- =============================================================================

select test_result.begin_suite('39 razorpay');

-- -----------------------------------------------------------------------------
-- The columns exist, and a fresh online order has no provider yet.
-- -----------------------------------------------------------------------------

select test_result.eq(
  'orders has payment_provider',
  (select count(*)::int from information_schema.columns
    where table_schema = 'public' and table_name = 'orders'
      and column_name = 'payment_provider'),
  1
);
select test_result.eq(
  'orders has payment_provider_order_id',
  (select count(*)::int from information_schema.columns
    where table_schema = 'public' and table_name = 'orders'
      and column_name = 'payment_provider_order_id'),
  1
);

-- -----------------------------------------------------------------------------
-- Fixtures.
--
--   d1  placed,    upi,  pending 12500  the happy path, later cancelled
--   d2  placed,    upi,  pending  9000  Ravi's order, for the ownership check
--   d3  placed,    card, pending  4500  the bad-shape cases
--   d4  placed,    cod,  pending  3000  cash has no gateway object
--   d5  cancelled, upi,  pending  5000  too late to pay
--   d6  placed,    upi,  paid     6000  already paid
--   d7  placed,    upi,  pending 11000  settled by service_role
--   d8  cancelled, upi,  pending  7000  a capture after the cancel is a refund
--   d9  placed,    cod,  pending  2000  the settlement path refuses cash
-- -----------------------------------------------------------------------------

reset role;
set role authenticated;
select test_result.sign_in('33333333-3333-3333-3333-333333333333');

insert into public.orders (
  id, user_id, store_id, address_id, delivery_address,
  status, payment_method, payment_status,
  subtotal_paise, delivery_fee_paise, discount_paise, total_paise,
  placed_at
)
values
  ('70000000-0000-4000-8000-0000000000d1',
   '11111111-1111-1111-1111-111111111111',
   '00000000-0000-4000-8000-000000000001',
   '50000000-0000-4000-8000-000000000001',
   '{"line1":"12, Gandhi Road","pincode":"572130"}'::jsonb,
   'placed', 'upi', 'pending', 12500, 0, 0, 12500,
   date '2020-02-22' + time '09:00'),

  ('70000000-0000-4000-8000-0000000000d2',
   '22222222-2222-2222-2222-222222222222',
   '00000000-0000-4000-8000-000000000001',
   '50000000-0000-4000-8000-000000000004',
   '{"line1":"4, Market Street","pincode":"572130"}'::jsonb,
   'placed', 'upi', 'pending', 9000, 0, 0, 9000,
   date '2020-02-22' + time '09:05'),

  ('70000000-0000-4000-8000-0000000000d3',
   '11111111-1111-1111-1111-111111111111',
   '00000000-0000-4000-8000-000000000001',
   '50000000-0000-4000-8000-000000000001',
   '{"line1":"12, Gandhi Road","pincode":"572130"}'::jsonb,
   'placed', 'card', 'pending', 4500, 0, 0, 4500,
   date '2020-02-22' + time '09:10'),

  ('70000000-0000-4000-8000-0000000000d4',
   '11111111-1111-1111-1111-111111111111',
   '00000000-0000-4000-8000-000000000001',
   '50000000-0000-4000-8000-000000000001',
   '{"line1":"12, Gandhi Road","pincode":"572130"}'::jsonb,
   'placed', 'cod', 'pending', 3000, 0, 0, 3000,
   date '2020-02-22' + time '09:15'),

  ('70000000-0000-4000-8000-0000000000d5',
   '11111111-1111-1111-1111-111111111111',
   '00000000-0000-4000-8000-000000000001',
   '50000000-0000-4000-8000-000000000001',
   '{"line1":"12, Gandhi Road","pincode":"572130"}'::jsonb,
   'cancelled', 'upi', 'pending', 5000, 0, 0, 5000,
   date '2020-02-22' + time '09:20'),

  ('70000000-0000-4000-8000-0000000000d6',
   '11111111-1111-1111-1111-111111111111',
   '00000000-0000-4000-8000-000000000001',
   '50000000-0000-4000-8000-000000000001',
   '{"line1":"12, Gandhi Road","pincode":"572130"}'::jsonb,
   'placed', 'upi', 'paid', 6000, 0, 0, 6000,
   date '2020-02-22' + time '09:25'),

  ('70000000-0000-4000-8000-0000000000d7',
   '11111111-1111-1111-1111-111111111111',
   '00000000-0000-4000-8000-000000000001',
   '50000000-0000-4000-8000-000000000001',
   '{"line1":"12, Gandhi Road","pincode":"572130"}'::jsonb,
   'placed', 'upi', 'pending', 11000, 0, 0, 11000,
   date '2020-02-22' + time '09:30'),

  ('70000000-0000-4000-8000-0000000000d8',
   '11111111-1111-1111-1111-111111111111',
   '00000000-0000-4000-8000-000000000001',
   '50000000-0000-4000-8000-000000000001',
   '{"line1":"12, Gandhi Road","pincode":"572130"}'::jsonb,
   'cancelled', 'upi', 'pending', 7000, 0, 0, 7000,
   date '2020-02-22' + time '09:35'),

  ('70000000-0000-4000-8000-0000000000d9',
   '11111111-1111-1111-1111-111111111111',
   '00000000-0000-4000-8000-000000000001',
   '50000000-0000-4000-8000-000000000001',
   '{"line1":"12, Gandhi Road","pincode":"572130"}'::jsonb,
   'placed', 'cod', 'pending', 2000, 0, 0, 2000,
   date '2020-02-22' + time '09:40');

select test_result.eq(
  'a fresh online order has no gateway object yet',
  (select payment_provider from public.orders
    where id = '70000000-0000-4000-8000-0000000000d1'),
  null
);

-- =============================================================================
-- 1. The intent belongs to the order's own customer.
-- =============================================================================

select test_result.sign_in('22222222-2222-2222-2222-222222222222');   -- Ravi

select test_result.refused(
  'another customer cannot attach a payment to somebody else''s order',
  $$ select public.set_order_payment_intent(
       '70000000-0000-4000-8000-0000000000d1', 'order_AshaOnly01') $$,
  '42501'
);

select test_result.sign_in('44444444-4444-4444-4444-444444444444');   -- Rider

select test_result.refused(
  'a rider cannot attach a payment to a customer''s order',
  $$ select public.set_order_payment_intent(
       '70000000-0000-4000-8000-0000000000d1', 'order_AshaOnly02') $$,
  '42501'
);

select test_result.sign_out();

select test_result.refused(
  'a signed-out caller cannot attach a payment',
  $$ select public.set_order_payment_intent(
       '70000000-0000-4000-8000-0000000000d1', 'order_AshaOnly03') $$,
  '42501'
);

select test_result.sign_in('11111111-1111-1111-1111-111111111111');   -- Asha

-- =============================================================================
-- 2. The happy path, and the id that may never change.
-- =============================================================================

do $$
declare
  v_order public.orders;
  v_first timestamptz;
begin
  v_order := public.set_order_payment_intent(
    '70000000-0000-4000-8000-0000000000d1', 'order_AshaPay01');

  perform test_result.eq(
    'the customer records which gateway order pays this basket',
    v_order.payment_provider,
    'razorpay'
  );
  perform test_result.eq(
    'and the gateway order id is stored exactly',
    v_order.payment_provider_order_id,
    'order_AshaPay01'
  );
  perform test_result.eq(
    'recording an intent does NOT mark the order paid',
    v_order.payment_status::text,
    'pending'
  );

  v_first := v_order.updated_at;

  -- Same id: the same fact, so a retry is safe (rule 9.4).
  v_order := public.set_order_payment_intent(
    '70000000-0000-4000-8000-0000000000d1', 'order_AshaPay01');

  perform test_result.eq(
    'the same gateway id twice is a safe retry',
    v_order.payment_provider_order_id,
    'order_AshaPay01'
  );
  perform test_result.ok(
    'and the retry did not rewrite the row',
    v_order.updated_at = v_first
  );
end;
$$;

select test_result.refused(
  'a second, DIFFERENT gateway object for one basket is refused',
  $$ select public.set_order_payment_intent(
       '70000000-0000-4000-8000-0000000000d1', 'order_AshaPay02') $$,
  '23505'
);

select test_result.eq(
  'the refused second id did not overwrite the first',
  (select payment_provider_order_id from public.orders
    where id = '70000000-0000-4000-8000-0000000000d1'),
  'order_AshaPay01'
);

-- =============================================================================
-- 3. The id must look like a Razorpay order id.
-- =============================================================================

select test_result.refused(
  'a payment id is not an order id',
  $$ select public.set_order_payment_intent(
       '70000000-0000-4000-8000-0000000000d3', 'pay_AshaPay01') $$,
  '22023'
);
select test_result.refused(
  'an order id with no body is refused',
  $$ select public.set_order_payment_intent(
       '70000000-0000-4000-8000-0000000000d3', 'order_') $$,
  '22023'
);
select test_result.refused(
  'a blank order id is refused',
  $$ select public.set_order_payment_intent(
       '70000000-0000-4000-8000-0000000000d3', '   ') $$,
  '22023'
);
select test_result.refused(
  'a NULL order id is refused',
  $$ select public.set_order_payment_intent(
       '70000000-0000-4000-8000-0000000000d3', null) $$,
  '22023'
);

-- =============================================================================
-- 4. Only a live, unpaid, online order can take a payment.
-- =============================================================================

select test_result.refused(
  'a cash order has no gateway object',
  $$ select public.set_order_payment_intent(
       '70000000-0000-4000-8000-0000000000d4', 'order_AshaCash01') $$,
  '22023'
);
select test_result.refused(
  'a cancelled order is too late to pay',
  $$ select public.set_order_payment_intent(
       '70000000-0000-4000-8000-0000000000d5', 'order_AshaLate01') $$,
  '22023'
);
select test_result.refused(
  'an already-paid order has nothing to start',
  $$ select public.set_order_payment_intent(
       '70000000-0000-4000-8000-0000000000d6', 'order_AshaPaid01') $$,
  '22023'
);
select test_result.refused(
  'an unknown order is refused, not ignored',
  $$ select public.set_order_payment_intent(
       '70000000-0000-4000-8000-0000000000ff', 'order_AshaNope01') $$,
  'P0002'
);

-- =============================================================================
-- 5. Only the gateway (or the shop) may settle money.
-- =============================================================================

select test_result.sign_in('11111111-1111-1111-1111-111111111111');

select test_result.refused(
  'a customer cannot mark their own order paid',
  $$ select public.settle_online_payment(
       '70000000-0000-4000-8000-0000000000d7', 'pay_AshaSettle01') $$,
  '42501'
);

select test_result.sign_in('44444444-4444-4444-4444-444444444444');

select test_result.refused(
  'a rider cannot settle a payment',
  $$ select public.settle_online_payment(
       '70000000-0000-4000-8000-0000000000d7', 'pay_RiderSettle01') $$,
  '42501'
);

reset role;
set role anon;

select test_result.refused(
  'an anonymous caller cannot settle a payment',
  $$ select public.settle_online_payment(
       '70000000-0000-4000-8000-0000000000d7', 'pay_AnonSettle01') $$,
  '42501'
);

-- =============================================================================
-- 6. The gateway settles, and the reference is the fact.
-- =============================================================================

reset role;
set role service_role;

select test_result.refused(
  'a payment id shaped like an order id is refused',
  $$ select public.settle_online_payment(
       '70000000-0000-4000-8000-0000000000d7', 'order_NotAPayment') $$,
  '22023'
);
select test_result.refused(
  'a blank payment reference is refused',
  $$ select public.settle_online_payment(
       '70000000-0000-4000-8000-0000000000d7', '  ') $$,
  '22023'
);

do $$
declare
  v_order public.orders;
begin
  v_order := public.settle_online_payment(
    '70000000-0000-4000-8000-0000000000d7', 'pay_AshaSettle01');

  perform test_result.eq(
    'service_role records the verified payment',
    v_order.payment_status::text,
    'paid'
  );
  perform test_result.eq(
    'and stores the gateway''s payment id',
    v_order.payment_reference,
    'pay_AshaSettle01'
  );
end;
$$;

-- Same reference: the webhook and the app both arriving is normal.
do $$
declare
  v_order public.orders;
begin
  v_order := public.settle_online_payment(
    '70000000-0000-4000-8000-0000000000d7', 'pay_AshaSettle01');

  perform test_result.eq(
    'the same settlement twice is a safe retry',
    v_order.payment_status::text,
    'paid'
  );
end;
$$;

select test_result.refused(
  'a second, DIFFERENT payment id raises instead of hiding a double charge',
  $$ select public.settle_online_payment(
       '70000000-0000-4000-8000-0000000000d7', 'pay_AshaSettle02') $$,
  '23505'
);

-- service_role is not granted SELECT on the tables in this harness (it is in
-- production), so read the row back as the owner.
reset role;
set role authenticated;
select test_result.sign_in('33333333-3333-3333-3333-333333333333');

select test_result.eq(
  'the refused second payment id did not overwrite the first',
  (select payment_reference from public.orders
    where id = '70000000-0000-4000-8000-0000000000d7'),
  'pay_AshaSettle01'
);

reset role;
set role service_role;

-- =============================================================================
-- 7. A capture after the cancel is recorded as a refund liability.
-- =============================================================================

-- The customer paid, then the shop cancelled. The money is real, so refusing to
-- record it would leave the shop holding cash it does not know about. Settling
-- is allowed; the generated column turns it into "owed back".
do $$
declare
  v_order public.orders;
begin
  v_order := public.settle_online_payment(
    '70000000-0000-4000-8000-0000000000d8', 'pay_AshaClosed01');

  perform test_result.eq(
    'a verified capture on a cancelled order is recorded',
    v_order.payment_status::text,
    'paid'
  );
  perform test_result.eq(
    'and the same row now owes the customer the money back',
    v_order.refund_due_paise,
    7000
  );
end;
$$;

select test_result.refused(
  'a cash order is settled by the cash path, not this one',
  $$ select public.settle_online_payment(
       '70000000-0000-4000-8000-0000000000d9', 'pay_AshaCash01') $$,
  '22023'
);
select test_result.refused(
  'an unknown order is refused for settlement too',
  $$ select public.settle_online_payment(
       '70000000-0000-4000-8000-0000000000ff', 'pay_AshaNope01') $$,
  'P0002'
);

-- =============================================================================
-- 8. The flag is not the permission: shape checks still hold.
-- =============================================================================

-- Production's service_role holds table privileges; this harness only grants
-- them to `authenticated`. Supply the missing grant so the UPDATE below reaches
-- the guard instead of failing on a privilege the real caller has.
reset role;
grant select, insert, update, delete on public.orders to service_role;
set role service_role;

-- The owner's JWT was still in the session from the section above, and the
-- guard lets an admin through before it looks at any flag. Sign out so these
-- two writes are judged as the gateway caller, which is the point.
select test_result.sign_out();

-- service_role can bypass RLS, so this reaches the guard. The flag says "a
-- settlement", the shape says a cancelled order — which a settlement may not
-- produce. The guard must refuse rather than let the flag be the password.
select test_result.refused(
  'a forged settlement flag cannot change a status',
  $$ select set_config('kunigal.settling_payment', 'on', true);
     update public.orders
        set payment_status = 'paid',
            payment_reference = 'pay_ForgedShape01',
            status = 'cancelled'
      where id = '70000000-0000-4000-8000-0000000000d9' $$,
  '42501'
);

select test_result.refused(
  'a forged intent flag cannot change a total',
  $$ select set_config('kunigal.payment_intent', 'on', true);
     update public.orders
        set payment_provider = 'razorpay',
            payment_provider_order_id = 'order_ForgedShape01',
            total_paise = 1
      where id = '70000000-0000-4000-8000-0000000000d9' $$,
  '42501'
);

reset role;
select set_config('kunigal.settling_payment', 'off', true);
select set_config('kunigal.payment_intent', 'off', true);

-- =============================================================================
-- 9. The silent path the functions replace.
-- =============================================================================

set role authenticated;
select test_result.sign_in('11111111-1111-1111-1111-111111111111');

select test_result.touches(
  'a customer''s direct update of payment_status touches zero rows',
  $$ update public.orders set payment_status = 'paid'
      where id = '70000000-0000-4000-8000-0000000000d3' $$,
  0
);
select test_result.touches(
  'a customer''s direct write of a gateway id touches zero rows',
  $$ update public.orders set payment_provider_order_id = 'order_Sneaky01'
      where id = '70000000-0000-4000-8000-0000000000d3' $$,
  0
);

-- The database itself refuses an unknown provider, even from the shop.
select test_result.sign_in('33333333-3333-3333-3333-333333333333');

select test_result.refused(
  'an unknown provider is refused by the check constraint',
  $$ update public.orders set payment_provider = 'stripe'
      where id = '70000000-0000-4000-8000-0000000000d3' $$,
  '23514'
);

-- =============================================================================
-- 10. Settled money reaches the refund liability the customer is shown.
-- =============================================================================

-- d1 already carries an intent. The gateway settles it, then the shop cancels
-- (the customer rang the counter): the money is now owed back, and the
-- generated column says so without a second implementation of the rule.
reset role;
set role service_role;

select public.settle_online_payment(
  '70000000-0000-4000-8000-0000000000d1', 'pay_AshaRefund01');

reset role;
set role authenticated;
select test_result.sign_in('33333333-3333-3333-3333-333333333333');

update public.orders
   set status = 'cancelled',
       cancellation_reason = 'Customer called the shop'
 where id = '70000000-0000-4000-8000-0000000000d1';

select test_result.eq(
  'a settled order the shop cancels becomes money owed back',
  (select refund_due_paise from public.orders
    where id = '70000000-0000-4000-8000-0000000000d1'),
  12500
);

-- The owner's ledger sums the same column, so a UPI refund cannot vanish from
-- the day's books either. 12500 (d1) + 7000 (d8) is everything the shop holds.
select test_result.eq(
  'the day''s refund liability includes UPI, not just the legacy online method',
  (public.shop_day_totals('2020-02-22')).refund_due_paise,
  19500::bigint
);

do $$
declare
  v_order public.orders;
begin
  v_order := public.mark_refund_paid('70000000-0000-4000-8000-0000000000d1');

  perform test_result.eq(
    'the refund path clears the liability the settlement created',
    v_order.refund_due_paise,
    0::bigint
  );
end;
$$;

select test_result.eq(
  'and the day owes only the order nobody has refunded yet',
  (public.shop_day_totals('2020-02-22')).refund_due_paise,
  7000::bigint
);
