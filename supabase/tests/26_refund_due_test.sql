-- =============================================================================
-- 26 · refund_due_paise: the money the shop owes, on one order
--
-- The owner's Today tab has reported a refund liability since migration
-- 20261021000002, but the customer was never told. Migration 20261106000002
-- makes it a GENERATED column on `orders` so the customer's screen and the
-- shop's books cannot drift apart: both read a number Postgres computes, and
-- neither the app nor a customer can write it.
--
-- Rule 9.7: a new column and a new rule are not done until a test proves the
-- forbidden case fails. The claims this file makes true are:
--
--   1. an online payment still marked `paid` on a cancelled, failed or returned
--      order owes exactly its total;
--   2. delivered, COD, unpaid and already-refunded orders owe nothing — the
--      four ways a number could be wrong;
--   3. the sum of the column on a day equals what `shop_day_totals()` reports
--      for that day, so the two implementations of one rule agree;
--   4. the shop can zero it by marking the payment `refunded`, which is what
--      makes it "still owed" rather than "was ever paid";
--   5. nobody can insert or update the column directly (428C9), because a
--      generated value that a client can set is not a fact;
--   6. the order's own customer can read it; another customer cannot.
--
-- TWO TRAPS, both learned the hard way in tests 18–20:
--   * `orders_guard_insert` forces a customer's order to `placed`, and
--     `current_user_role()` falls back to `customer` when `auth.uid()` is null,
--     so every fixture past `placed` is inserted as the ADMIN;
--   * the day must be fixed and quiet. 2020-02-20 is used by no other suite
--     (test 19 owns 2020-01-15), so these figures cannot depend on what another
--     test left behind.
-- =============================================================================

select test_result.begin_suite('26 refund due');

-- -----------------------------------------------------------------------------
-- Fixtures, as the shop owner. One quiet day, eight orders, one rule each.
--
--   b1  cancelled, online, paid      -> 12000  (the refund case)
--   b2  failed,    online, paid      ->  8000  (never arrived)
--   b3  returned,  online, paid      ->  5000  (came back to the shop)
--   b4  delivered, online, paid      ->     0  (it arrived; no refund)
--   b5  cancelled, COD,    paid      ->     0  (cash, not a payment to return)
--   b6  cancelled, online, pending   ->     0  (no money was taken)
--   b7  cancelled, online, refunded  ->     0  (already given back)
--   b8  failed,    COD,    pending   ->     0  (cash never collected)
--
-- The sum of the owed rows is 25000, which is the number the day's books must
-- report too.
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
  ('70000000-0000-4000-8000-0000000000b1',
   '11111111-1111-1111-1111-111111111111',
   '00000000-0000-4000-8000-000000000001',
   '50000000-0000-4000-8000-000000000001',
   '{"line1":"12, Gandhi Road","pincode":"572130"}'::jsonb,
   'cancelled', 'online', 'paid', 12000, 0, 0, 12000,
   date '2020-02-20' + time '10:00', null, null),

  ('70000000-0000-4000-8000-0000000000b2',
   '11111111-1111-1111-1111-111111111111',
   '00000000-0000-4000-8000-000000000001',
   '50000000-0000-4000-8000-000000000001',
   '{"line1":"12, Gandhi Road","pincode":"572130"}'::jsonb,
   'failed', 'online', 'paid', 8000, 0, 0, 8000,
   date '2020-02-20' + time '11:00', null, 'not_home'),

  ('70000000-0000-4000-8000-0000000000b3',
   '11111111-1111-1111-1111-111111111111',
   '00000000-0000-4000-8000-000000000001',
   '50000000-0000-4000-8000-000000000001',
   '{"line1":"12, Gandhi Road","pincode":"572130"}'::jsonb,
   'returned', 'online', 'paid', 5000, 0, 0, 5000,
   date '2020-02-20' + time '12:00', null, 'refused'),

  ('70000000-0000-4000-8000-0000000000b4',
   '11111111-1111-1111-1111-111111111111',
   '00000000-0000-4000-8000-000000000001',
   '50000000-0000-4000-8000-000000000001',
   '{"line1":"12, Gandhi Road","pincode":"572130"}'::jsonb,
   'delivered', 'online', 'paid', 9000, 0, 0, 9000,
   date '2020-02-20' + time '13:00', date '2020-02-20' + time '13:30', null),

  ('70000000-0000-4000-8000-0000000000b5',
   '11111111-1111-1111-1111-111111111111',
   '00000000-0000-4000-8000-000000000001',
   '50000000-0000-4000-8000-000000000001',
   '{"line1":"12, Gandhi Road","pincode":"572130"}'::jsonb,
   'cancelled', 'cod', 'paid', 7000, 0, 0, 7000,
   date '2020-02-20' + time '14:00', null, null),

  ('70000000-0000-4000-8000-0000000000b6',
   '11111111-1111-1111-1111-111111111111',
   '00000000-0000-4000-8000-000000000001',
   '50000000-0000-4000-8000-000000000001',
   '{"line1":"12, Gandhi Road","pincode":"572130"}'::jsonb,
   'cancelled', 'online', 'pending', 6000, 0, 0, 6000,
   date '2020-02-20' + time '15:00', null, null),

  ('70000000-0000-4000-8000-0000000000b7',
   '11111111-1111-1111-1111-111111111111',
   '00000000-0000-4000-8000-000000000001',
   '50000000-0000-4000-8000-000000000001',
   '{"line1":"12, Gandhi Road","pincode":"572130"}'::jsonb,
   'cancelled', 'online', 'refunded', 4000, 0, 0, 4000,
   date '2020-02-20' + time '16:00', null, null),

  ('70000000-0000-4000-8000-0000000000b8',
   '22222222-2222-2222-2222-222222222222',
   '00000000-0000-4000-8000-000000000001',
   '50000000-0000-4000-8000-000000000004',
   '{"line1":"45, Nehru Nagar","pincode":"572130"}'::jsonb,
   'failed', 'cod', 'pending', 3000, 0, 0, 3000,
   date '2020-02-20' + time '17:00', null, 'unreachable')
on conflict (id) do nothing;

select test_result.eq(
  'the fixture orders landed as written (the insert was not rewritten)',
  (select count(*)::text from public.orders
    where id between '70000000-0000-4000-8000-0000000000b1'
                 and '70000000-0000-4000-8000-0000000000b8'),
  '8'
);

select test_result.eq(
  'the quiet day holds exactly these eight orders',
  (select count(*)::text from public.orders
    where placed_at >= (date '2020-02-20')::timestamp at time zone 'Asia/Kolkata'
      and placed_at <  ((date '2020-02-20' + 1))::timestamp at time zone 'Asia/Kolkata'),
  '8'
);

-- =============================================================================
-- The value, per order: one line per way the rule could be wrong.
-- =============================================================================

select test_result.eq(
  'a cancelled online order that was paid is owed in full',
  (select refund_due_paise::text from public.orders
    where id = '70000000-0000-4000-8000-0000000000b1'),
  '12000'
);

select test_result.eq(
  'an online order that failed is owed in full',
  (select refund_due_paise::text from public.orders
    where id = '70000000-0000-4000-8000-0000000000b2'),
  '8000'
);

select test_result.eq(
  'an online order that came back to the shop is owed in full',
  (select refund_due_paise::text from public.orders
    where id = '70000000-0000-4000-8000-0000000000b3'),
  '5000'
);

select test_result.eq(
  'a delivered online order owes nothing — the customer got the bag',
  (select refund_due_paise::text from public.orders
    where id = '70000000-0000-4000-8000-0000000000b4'),
  '0'
);

select test_result.eq(
  'a cancelled COD order owes nothing — no payment to give back',
  (select refund_due_paise::text from public.orders
    where id = '70000000-0000-4000-8000-0000000000b5'),
  '0'
);

select test_result.eq(
  'an online order whose payment never went through owes nothing',
  (select refund_due_paise::text from public.orders
    where id = '70000000-0000-4000-8000-0000000000b6'),
  '0'
);

select test_result.eq(
  'an order already marked refunded owes nothing any more',
  (select refund_due_paise::text from public.orders
    where id = '70000000-0000-4000-8000-0000000000b7'),
  '0'
);

select test_result.eq(
  'a failed COD delivery owes nothing — that cash was never collected',
  (select refund_due_paise::text from public.orders
    where id = '70000000-0000-4000-8000-0000000000b8'),
  '0'
);

-- =============================================================================
-- The two implementations of one rule agree on the same day.
--
-- `shop_day_totals()` filters by `placed_at` and active stores; the column is
-- per row. Summing one and asking the other must produce the same number, which
-- is the whole reason the rule was not copied into the app a third time.
-- =============================================================================

select test_result.eq(
  'the day''s books report the same refund total as the column',
  (select refund_due_paise::text from public.shop_day_totals(date '2020-02-20')),
  (select coalesce(sum(refund_due_paise), 0)::text from public.orders
    where placed_at >= (date '2020-02-20')::timestamp at time zone 'Asia/Kolkata'
      and placed_at <  ((date '2020-02-20' + 1))::timestamp at time zone 'Asia/Kolkata')
);

select test_result.eq(
  'and that total is the three online-and-paid failures',
  (select refund_due_paise::text from public.shop_day_totals(date '2020-02-20')),
  '25000'
);

-- =============================================================================
-- Nobody can write it. A generated column that a client can set is not a fact.
-- =============================================================================

reset role;

select test_result.refused(
  'an insert cannot supply the refund amount',
  $$
  insert into public.orders (
    id, user_id, store_id, delivery_address,
    status, payment_method, payment_status,
    subtotal_paise, delivery_fee_paise, discount_paise, total_paise,
    refund_due_paise
  )
  values (
    '70000000-0000-4000-8000-0000000000bf',
    '11111111-1111-1111-1111-111111111111',
    '00000000-0000-4000-8000-000000000001',
    '{"line1":"12, Gandhi Road","pincode":"572130"}'::jsonb,
    'cancelled', 'online', 'paid', 100, 0, 0, 100, 100
  )
  $$,
  '428C9'
);

select test_result.refused(
  'an update cannot set the refund amount either',
  $$
  update public.orders set refund_due_paise = 0
   where id = '70000000-0000-4000-8000-0000000000b1'
  $$,
  '428C9'
);

-- =============================================================================
-- The shop can clear it the honest way: mark the money returned.
-- =============================================================================

set role authenticated;
select test_result.sign_in('33333333-3333-3333-3333-333333333333');

update public.orders
   set payment_status = 'refunded'
 where id = '70000000-0000-4000-8000-0000000000b1';

select test_result.eq(
  'marking the payment refunded clears the amount owed',
  (select refund_due_paise::text from public.orders
    where id = '70000000-0000-4000-8000-0000000000b1'),
  '0'
);

select test_result.eq(
  'and the day''s books drop by exactly that order',
  (select refund_due_paise::text from public.shop_day_totals(date '2020-02-20')),
  '13000'
);

-- =============================================================================
-- Who can read it. It is a column on the order, so the existing orders policy
-- carries it: the customer sees their own, and nobody else's.
-- =============================================================================

set role authenticated;
select test_result.sign_in('11111111-1111-1111-1111-111111111111');

select test_result.eq(
  'the customer sees the refund owed on her own order',
  (select refund_due_paise::text from public.orders
    where id = '70000000-0000-4000-8000-0000000000b2'),
  '8000'
);

set role authenticated;
select test_result.sign_in('22222222-2222-2222-2222-222222222222');

select test_result.eq(
  'another customer cannot see that order at all',
  (select count(*)::text from public.orders
    where id = '70000000-0000-4000-8000-0000000000b2'),
  '0'
);

-- =============================================================================
-- Cleanup: leave the graph as found.
-- =============================================================================

reset role;

delete from public.orders
 where id in ('70000000-0000-4000-8000-0000000000b1',
              '70000000-0000-4000-8000-0000000000b2',
              '70000000-0000-4000-8000-0000000000b3',
              '70000000-0000-4000-8000-0000000000b4',
              '70000000-0000-4000-8000-0000000000b5',
              '70000000-0000-4000-8000-0000000000b6',
              '70000000-0000-4000-8000-0000000000b7',
              '70000000-0000-4000-8000-0000000000b8');
