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
--   3. the refund line in `shop_day_totals()` is the shop's outstanding
--      liability AS OF NOW, not a slice of the requested day: an order placed
--      ten days ago and cancelled today is owed today (migration
--      20261113000005). Two different days - including a day with no orders
--      at all - report the same number, and that number is the sum of the
--      per-order columns;
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
--   b9  cancelled, online, paid      ->  4000  (placed TEN DAYS EARLIER)
--
-- The sum of the owed rows is 29000: 25000 placed on the quiet day and 4000
-- on 2020-02-10. b9 is the row that proves the refund line is a running
-- balance rather than a day's figure - the old implementation reported 25000
-- on 2020-02-20 and 0 on 2020-02-10, and the shop owed 29000 the whole time.
-- -----------------------------------------------------------------------------

reset role;
set role authenticated;
select test_result.sign_in('33333333-3333-3333-3333-333333333333');

-- What the shop already owed before this suite touched anything. Other suites
-- run before this one in the same database, so the absolute running balance is
-- not ours to hard-code; every assertion below is a DELTA from this line.
drop table if exists test26_baseline;
create temporary table test26_baseline as
select (
  coalesce(sum(o.refund_due_paise), 0)
  + coalesce(sum(o.shortage_refund_paise) filter (
      where o.shortage_refund_paid_at is null
    ), 0)
)::bigint as owed
from public.orders o
where o.store_id in (select id from public.stores where is_active);

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
   date '2020-02-20' + time '17:00', null, 'unreachable'),

  ('70000000-0000-4000-8000-0000000000b9',
   '11111111-1111-1111-1111-111111111111',
   '00000000-0000-4000-8000-000000000001',
   '50000000-0000-4000-8000-000000000001',
   '{"line1":"12, Gandhi Road","pincode":"572130"}'::jsonb,
   'cancelled', 'online', 'paid', 4000, 0, 0, 4000,
   date '2020-02-10' + time '09:00', null, null)
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

select test_result.eq(
  'the cross-day order is a real order on another day (2020-02-10, IST)',
  (select (placed_at at time zone 'Asia/Kolkata')::date::text from public.orders
    where id = '70000000-0000-4000-8000-0000000000b9'),
  '2020-02-10'
);

select test_result.eq(
  'and it owes its full 4000, ten days before the fixture day',
  (select refund_due_paise::text from public.orders
    where id = '70000000-0000-4000-8000-0000000000b9'),
  '4000'
);

-- =============================================================================
-- The refund line is a RUNNING BALANCE, not a day's figure.
--
-- Migration 20261113000005 changed exactly this one number. An order placed
-- last week and cancelled this morning is money the shop owes THIS MORNING,
-- so a day with no orders at all must still report the liability, and the
-- quiet fixture day must report the same total as that empty day.
-- =============================================================================

select test_result.eq(
  'a day with no orders still reports the shop''s outstanding liability',
  (select refund_due_paise::text from public.shop_day_totals(date '2019-01-01')),
  (select (
     coalesce(sum(o.refund_due_paise), 0)
     + coalesce(sum(o.shortage_refund_paise) filter (
         where o.shortage_refund_paid_at is null
       ), 0)
   )::bigint::text
   from public.orders o
   where o.store_id in (select id from public.stores where is_active))
);

select test_result.eq(
  'that day really has no takings — the refund line is not hiding a day filter',
  (select (orders_placed::text || '/' || gross_paise::text)
     from public.shop_day_totals(date '2019-01-01')),
  '0/0'
);

select test_result.eq(
  'the quiet fixture day reports the same running liability',
  (select refund_due_paise::text from public.shop_day_totals(date '2020-02-20')),
  (select (
     coalesce(sum(o.refund_due_paise), 0)
     + coalesce(sum(o.shortage_refund_paise) filter (
         where o.shortage_refund_paid_at is null
       ), 0)
   )::bigint::text
   from public.orders o
   where o.store_id in (select id from public.stores where is_active))
);

select test_result.eq(
  'the fixture added its full 29000 — the 25000 day plus the 4000 from ten days earlier',
  (select refund_due_paise::text from public.shop_day_totals(date '2020-02-20')),
  (select (b.owed + 29000)::text from test26_baseline b)
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
  'and the running liability drops by exactly that order (29000 − 12000)',
  (select refund_due_paise::text from public.shop_day_totals(date '2019-01-01')),
  (select (b.owed + 17000)::text from test26_baseline b)
);

select test_result.eq(
  'which is the sum of what the other owed orders still carry',
  (select refund_due_paise::text from public.shop_day_totals(date '2019-01-01')),
  (select (
     coalesce(sum(o.refund_due_paise), 0)
     + coalesce(sum(o.shortage_refund_paise) filter (
         where o.shortage_refund_paid_at is null
       ), 0)
   )::bigint::text
   from public.orders o
   where o.store_id in (select id from public.stores where is_active))
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
              '70000000-0000-4000-8000-0000000000b8',
              '70000000-0000-4000-8000-0000000000b9');

drop table if exists test26_baseline;
