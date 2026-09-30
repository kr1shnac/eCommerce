-- =============================================================================
-- 19 · The owner's day: the takings, computed in the database.
--
-- Rule 9.7: a new function, and especially a new SECURITY DEFINER one, is not
-- done until a test proves it refuses the forbidden case. The claims this file
-- makes true are:
--
--   1. a customer and a signed-out caller are BOTH refused (the door);
--   2. the totals are right: cancelled is not a sale, failed is not cash, and
--      cash in hand is COD-but-not-yet-paid only;
--   3. the totals are computed over the whole day, in the database, not over
--      what the app happened to fetch — the property that made this a function
--      and not a query in the client;
--   4. the per-rider breakdown points at the right pocket.
--
-- TWO TRAPS THIS FILE HAD TO LEARN, both worth knowing before editing it.
--
-- 1. `orders_guard_insert` forces `status := 'placed'` whenever
--    `current_user_role()` is `customer`, and `current_user_role()` FALLS BACK
--    to `customer` when `auth.uid()` is null. So fixture orders past `placed`
--    must be inserted while signed in as the ADMIN. (Same trap as test 18.)
--
-- 2. **The day cannot be "today".** Test 12 loads `supabase/demo.sql`, which
--    inserts 25 orders with `placed_at = now()` — so by the time this file runs,
--    "today" in the shared database already holds 28 orders that this test did
--    not create. Asserting against today would make every figure here depend on
--    another suite, and the test would pass or fail for reasons of its own
--    making. So the fixture orders are placed on a FIXED PAST DATE that no other
--    test uses, and every figure is asserted for that date. Today is checked
--    separately, and only for the one thing that is actually true of it: that
--    the default day is today in the shop's timezone.
-- =============================================================================

select test_result.begin_suite('19 shop totals');

-- -----------------------------------------------------------------------------
-- Fixtures. A fresh rider and a set of orders that exercise every rule at once,
-- all on one deliberately quiet day.
-- -----------------------------------------------------------------------------

reset role;

insert into auth.users (id, phone, raw_user_meta_data) values
  ('99999999-9999-9999-9999-999999999999', '+919800000009', '{"full_name":"Rider Four"}')
on conflict (id) do nothing;

update public.profiles
set role = 'delivery'
where id = '99999999-9999-9999-9999-999999999999';

-- The quiet day, written out as a literal wherever it is needed.
-- 2020-01-15 is long past, so no seed or demo row can share it, and it will not
-- drift into "today" no matter when the suite runs.
--
-- It is a literal and not a temporary table on purpose: a temp table belongs to
-- the role that created it, and the queries below run as `authenticated`, which
-- would be refused permission on a table owned by the migration role.

set role authenticated;
select test_result.sign_in('33333333-3333-3333-3333-333333333333');

-- 1. delivered, COD, PAID          -> cash_collected, delivered, gross
-- 2. delivered, COD, not paid      -> cash_in_hand, delivered, gross
-- 3. delivered, online, paid       -> delivered + gross, but NOT cash hand
-- 4. placed (in flight)            -> gross only
-- 5. cancelled                     -> nothing except the cancelled count
-- 6. failed, COD                   -> nothing except the failed count
-- 7. failed, PAID ONLINE           -> refund liability (the shop owes it back)
--
-- Totals the test will assert for that day:
--   gross        = 10000 + 20000 + 30000 + 40000 = 100000   (4 sales)
--   delivered    = 10000 + 20000 + 30000         =  60000   (3 landed)
--   cash in hand = 20000                                     (COD, not paid)
--   collected    = 10000                                     (COD, paid)
--   refund due   = 25000                                     (online + failed)
--   delivery fee = 100 x 4 sales                 =    400
--   discount     = 1000 (on the paid COD order)
--
-- Every row must satisfy `total = subtotal + delivery_fee - discount`, which the
-- pre-existing `orders_totals_add_up` CHECK enforces. The subtotals below are
-- therefore back-solved from the total, not written by eye.
insert into public.orders (
  id, user_id, store_id, address_id, delivery_address,
  status, payment_method, payment_status,
  subtotal_paise, delivery_fee_paise, discount_paise, total_paise,
  placed_at, delivered_at, failure_reason, assigned_to, assigned_at
)
values
  ('70000000-0000-4000-8000-0000000000a1',
   '11111111-1111-1111-1111-111111111111',
   '00000000-0000-4000-8000-000000000001',
   '50000000-0000-4000-8000-000000000001',
   '{"line1":"12, Gandhi Road","pincode":"572130"}'::jsonb,
   'delivered', 'cod', 'paid', 10900, 100, 1000, 10000,
   date '2020-01-15' + time '10:00', date '2020-01-15' + time '10:34', null,
   '99999999-9999-9999-9999-999999999999', date '2020-01-15' + time '10:03'),

  ('70000000-0000-4000-8000-0000000000a2',
   '11111111-1111-1111-1111-111111111111',
   '00000000-0000-4000-8000-000000000001',
   '50000000-0000-4000-8000-000000000001',
   '{"line1":"12, Gandhi Road","pincode":"572130"}'::jsonb,
   'delivered', 'cod', 'pending', 19900, 100, 0, 20000,
   date '2020-01-15' + time '11:00', date '2020-01-15' + time '11:40', null,
   '99999999-9999-9999-9999-999999999999', date '2020-01-15' + time '11:02'),

  ('70000000-0000-4000-8000-0000000000a3',
   '11111111-1111-1111-1111-111111111111',
   '00000000-0000-4000-8000-000000000001',
   '50000000-0000-4000-8000-000000000001',
   '{"line1":"12, Gandhi Road","pincode":"572130"}'::jsonb,
   'delivered', 'online', 'paid', 29900, 100, 0, 30000,
   date '2020-01-15' + time '12:00', date '2020-01-15' + time '12:30', null,
   '99999999-9999-9999-9999-999999999999', date '2020-01-15' + time '12:01'),

  ('70000000-0000-4000-8000-0000000000a4',
   '11111111-1111-1111-1111-111111111111',
   '00000000-0000-4000-8000-000000000001',
   '50000000-0000-4000-8000-000000000001',
   '{"line1":"12, Gandhi Road","pincode":"572130"}'::jsonb,
   'placed', 'cod', 'pending', 39900, 100, 0, 40000,
   date '2020-01-15' + time '13:00', null, null,
   null, null),

  ('70000000-0000-4000-8000-0000000000a5',
   '11111111-1111-1111-1111-111111111111',
   '00000000-0000-4000-8000-000000000001',
   '50000000-0000-4000-8000-000000000001',
   '{"line1":"12, Gandhi Road","pincode":"572130"}'::jsonb,
   'cancelled', 'cod', 'pending', 49900, 100, 0, 50000,
   date '2020-01-15' + time '14:00', null, null,
   null, null),

  ('70000000-0000-4000-8000-0000000000a6',
   '11111111-1111-1111-1111-111111111111',
   '00000000-0000-4000-8000-000000000001',
   '50000000-0000-4000-8000-000000000001',
   '{"line1":"12, Gandhi Road","pincode":"572130"}'::jsonb,
   'failed', 'cod', 'pending', 59900, 100, 0, 60000,
   date '2020-01-15' + time '15:00', null, 'not_home',
   '99999999-9999-9999-9999-999999999999', date '2020-01-15' + time '15:01'),

  -- 7. failed, but PAID ONLINE. This is the case that money must be given back:
  --    the shop holds ₹250 of the customer's money and delivered nothing. It is
  --    not a sale (so it stays out of gross) and not cash in a rider's pocket
  --    (so it stays out of cash_in_hand) — it is a refund liability, and without
  --    its own column it would be invisible on this screen.
  ('70000000-0000-4000-8000-0000000000a7',
   '11111111-1111-1111-1111-111111111111',
   '00000000-0000-4000-8000-000000000001',
   '50000000-0000-4000-8000-000000000001',
   '{"line1":"12, Gandhi Road","pincode":"572130"}'::jsonb,
   'failed', 'online', 'paid', 24900, 100, 0, 25000,
   date '2020-01-15' + time '16:00', null, 'unreachable',
   '99999999-9999-9999-9999-999999999999', date '2020-01-15' + time '16:01')
on conflict (id) do nothing;

select test_result.eq(
  'the fixture orders landed as written (the insert was not rewritten)',
  (select count(*)::text from public.orders
    where id in ('70000000-0000-4000-8000-0000000000a1',
                 '70000000-0000-4000-8000-0000000000a2',
                 '70000000-0000-4000-8000-0000000000a3',
                 '70000000-0000-4000-8000-0000000000a4',
                 '70000000-0000-4000-8000-0000000000a5',
                 '70000000-0000-4000-8000-0000000000a6',
                 '70000000-0000-4000-8000-0000000000a7')
      and status::text in ('delivered', 'placed', 'cancelled', 'failed')),
  '7'
);

select test_result.eq(
  'the quiet day really is empty apart from this test''s seven orders',
  (select count(*)::text from public.orders
    where placed_at >= (date '2020-01-15')::timestamp at time zone 'Asia/Kolkata'
      and placed_at <  ((date '2020-01-15' + 1))::timestamp at time zone 'Asia/Kolkata'),
  '7'
);

-- =============================================================================
-- The door: only the shop may ask.
-- =============================================================================

set role authenticated;
select test_result.sign_in('11111111-1111-1111-1111-111111111111');

select test_result.refused(
  'a customer cannot read the day''s takings',
  $$ select public.shop_day_totals() $$,
  '42501'
);

select test_result.refused(
  'and a customer cannot read the per-rider breakdown',
  $$ select * from public.shop_day_by_rider() $$,
  '42501'
);

-- A signed-out caller (auth.uid() null, so current_user_role() is the customer
-- fallback) is refused too. This is the case that would leak the shop's takings
-- to anyone holding the publishable key.
select test_result.sign_out();

select test_result.refused(
  'a signed-out caller cannot read the day''s takings',
  $$ select public.shop_day_totals() $$,
  '42501'
);

-- =============================================================================
-- The default day is today, in the shop's own timezone.
-- =============================================================================

set role authenticated;
select test_result.sign_in('33333333-3333-3333-3333-333333333333');

select test_result.eq(
  'with no argument, the day is today in Asia/Kolkata',
  (select the_day from public.shop_day_totals())::text,
  (now() at time zone 'Asia/Kolkata')::date::text
);

-- =============================================================================
-- The numbers, on the quiet day.
-- =============================================================================

select test_result.eq(
  'four orders counted as sales: cancelled and failed are not sales',
  (select orders_placed::bigint from public.shop_day_totals(date '2020-01-15')),
  4::bigint
);select test_result.eq(
  'three deliveries landed',
  (select orders_delivered::bigint from public.shop_day_totals(date '2020-01-15')),
  3::bigint
);

select test_result.eq(
  'the cancelled order is still visible as its own count',
  (select orders_cancelled::bigint from public.shop_day_totals(date '2020-01-15')),
  1::bigint
);

select test_result.eq(
  'the failed orders are their own count, not deliveries',
  (select orders_failed::bigint from public.shop_day_totals(date '2020-01-15')),
  2::bigint
);

select test_result.eq(
  'gross is the sales only — a failed delivery is not a sale',
  (select gross_paise from public.shop_day_totals(date '2020-01-15')),
  100000::bigint
);

select test_result.eq(
  'delivered is only what reached a home — failed is not money taken',
  (select delivered_paise from public.shop_day_totals(date '2020-01-15')),
  60000::bigint
);

select test_result.eq(
  'delivery charges given away are summed over sales only',
  (select delivery_fee_paise from public.shop_day_totals(date '2020-01-15')),
  400::bigint
);

select test_result.eq(
  'what the coupons cost the shop is summed',
  (select discount_paise from public.shop_day_totals(date '2020-01-15')),
  1000::bigint
);

select test_result.eq(
  'cash in hand is COD delivered and NOT yet paid — the odd ₹200',
  (select cash_in_hand_paise from public.shop_day_totals(date '2020-01-15')),
  20000::bigint
);

select test_result.eq(
  'cash collected is COD delivered and marked paid',
  (select cash_collected_paise from public.shop_day_totals(date '2020-01-15')),
  10000::bigint
);

select test_result.eq(
  'an online order never counts as cash a rider is carrying',
  (select (cash_in_hand_paise + cash_collected_paise = 30000)::text
     from public.shop_day_totals(date '2020-01-15')),
  'true'
);

-- =============================================================================
-- Money the shop owes back is visible, and is not counted as takings.
-- =============================================================================

select test_result.eq(
  'a paid-but-not-delivered order is a refund liability, not a sale',
  (select refund_due_paise from public.shop_day_totals(date '2020-01-15')),
  25000::bigint
);

select test_result.eq(
  'the refund money is not in gross, delivered or cash in hand',
  (select (gross_paise = 100000 and delivered_paise = 60000
           and cash_in_hand_paise = 20000 and refund_due_paise = 25000)::text
     from public.shop_day_totals(date '2020-01-15')),
  'true'
);

select test_result.eq(
  'a FAILED COD order is not a refund — that cash was never collected',
  (select (refund_due_paise = 25000)::text
     from public.shop_day_totals(date '2020-01-15')),
  'true'
);

-- =============================================================================
-- The day before is empty, and that is a real answer rather than an error.
-- =============================================================================

select test_result.eq(
  'the day before has no orders and every figure is zero, not null',
  (select (orders_placed = 0 and gross_paise = 0 and delivered_paise = 0
           and cash_in_hand_paise = 0)::text
     from public.shop_day_totals(date '2020-01-15' - 1)),
  'true'
);

-- =============================================================================
-- Whole-day, not whole-app: the property that made this a function.
-- =============================================================================

-- The owner's board fetches at most 100 orders. If the totals were computed from
-- that fetch, an active day would silently under-report. Asking the database
-- directly gives the same answer no matter what any client limited itself to.
select test_result.eq(
  'the totals see the whole day, not a client-limited slice',
  (select (orders_placed = 4 and gross_paise = 100000)::text
     from public.shop_day_totals(date '2020-01-15')),
  'true'
);

-- =============================================================================
-- The per-rider breakdown points at the right pocket.
-- =============================================================================

select test_result.eq(
  'the rider who delivered shows up once',
  (select count(*)::text from public.shop_day_by_rider(date '2020-01-15')
    where rider_id = '99999999-9999-9999-9999-999999999999'),
  '1'
);

select test_result.eq(
  'the rider is named in the breakdown',
  (select rider_name from public.shop_day_by_rider(date '2020-01-15')
    where rider_id = '99999999-9999-9999-9999-999999999999'),
  'Rider Four'
);

select test_result.eq(
  'the rider is carrying exactly the unpaid COD money',
  (select cash_to_collect_paise from public.shop_day_by_rider(date '2020-01-15')
    where rider_id = '99999999-9999-9999-9999-999999999999'),
  20000::bigint
);

select test_result.eq(
  'the unassigned orders are not attributed to a rider',
  (select count(*)::text from public.shop_day_by_rider(date '2020-01-15')
    where rider_id is null),
  '0'
);

-- =============================================================================
-- Cleanup: leave the graph as found.
-- =============================================================================

reset role;

delete from public.orders
 where id in ('70000000-0000-4000-8000-0000000000a1',
              '70000000-0000-4000-8000-0000000000a2',
              '70000000-0000-4000-8000-0000000000a3',
              '70000000-0000-4000-8000-0000000000a4',
              '70000000-0000-4000-8000-0000000000a5',
              '70000000-0000-4000-8000-0000000000a6',
              '70000000-0000-4000-8000-0000000000a7');

delete from public.profiles where id = '99999999-9999-9999-9999-999999999999';
delete from auth.users where id = '99999999-9999-9999-9999-999999999999';
