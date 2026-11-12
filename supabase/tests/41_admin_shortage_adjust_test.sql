-- =============================================================================
-- 41 · A shortage is settled by one function, and the books cannot be edited by hand
-- =============================================================================
-- Migration 20261112000009 replaces the two unguarded admin policies on
-- `order_items` (UPDATE and DELETE, both `using (public.is_admin())` — an edit
-- that silently desynced `orders.total_paise` from the lines) with ONE definer
-- function that recomputes the totals in the same transaction and puts the
-- released units back on the shelf's book. This suite proves:
--
--   1. A customer and a rider cannot reach the function (42501);
--   2. unknown order and unknown line are refused (P0002), never ignored;
--   3. nonsense quantities are refused (P0001): NULL, negative, over 99;
--   4. a bag that has left the shop is a fact: delivered, out_for_delivery
--      and cancelled orders are refused (P0001);
--   5. an INCREASE is refused — a shortage means less, never more;
--   6. reducing a line really does: subtotal and total recomputed from the
--      remaining lines, the released units back in stock, and the line's
--      price/name snapshot untouched;
--   7. the customer still reads her own order and lines (the SELECT policy);
--   8. quantity 0 takes the line off, but never the LAST line (that is a
--      cancellation, and `admin_cancel_order()` is the honest tool);
--   9. a repeat of the same call changes nothing (rule 9.4);
--  10. a coupon larger than the reduced basket is refused with a sentence
--      that says what to do instead — and moves NO stock on the way out;
--  11. the direct doors are GONE: only the SELECT policy survives, and an
--      admin's direct UPDATE/DELETE matches zero rows.
--
-- THE FIXTURE TRICK (learned from test 34): `guard_order_insert` forces
-- status='placed' on every order a CUSTOMER session inserts — and a fresh
-- psql session with no claim IS a customer session. So the fixture orders are
-- inserted AS THE SIGNED-IN OWNER (`set role authenticated` +
-- `test_result.sign_in(owner)` first), whom the guard leaves alone; then
-- `reset role` for the lines and the shelf, which are data, not the thing
-- under test (`order_items` has no insert policy at all — migration 08).
--
-- PRICES: `guard_order_item_insert` (migration 09) overwrites every line's
-- price and name from the products row — the catalogue is the source of truth
-- even in a fixture. The shelf is SET below to the seed shelf first:
-- tomato `...0001` @1800, onion `...0002` @2600.
--
-- Stock ledger used below (both restored at the end):
--   tomato ...0001: 40 → +4 (10→6) → +1 (a2's tomato line off) = 45
--   onion  ...0002: 60 → +3 (a1's onion line off)              = 63
-- =============================================================================

select test_result.begin_suite('41 admin shortage adjust');

-- -----------------------------------------------------------------------------
-- 1. The orders, as the signed-in owner (see the fixture trick above).
--
--   a1  Asha,  placed:            10 × tomato @1800 + 3 × onion @2600  (25800)
--   a2  Ravi,  placed, coupon:     1 × tomato @1800 + 2 × onion @2600  (7000 - 6000)
--   a3  Asha,  delivered:          2 × tomato                          (terminal)
--   a4  Asha,  out_for_delivery:   2 × onion                           (rider counted it)
--   a5  Asha,  cancelled:          1 × tomato + 1 × onion              (two lines: the
--                                                                       refused call below
--                                                                       must fail on the
--                                                                       STATUS, not on
--                                                                       the last-line rule)
--   a6  Asha,  placed:             2 × tomato                          (the only line)
-- -----------------------------------------------------------------------------
set role authenticated;
select test_result.sign_in('33333333-3333-3333-3333-333333333333');   -- Owner

insert into public.orders (
  id, user_id, store_id, address_id, delivery_address,
  status, payment_method, payment_status,
  subtotal_paise, delivery_fee_paise, discount_paise, total_paise,
  placed_at, delivered_at, coupon_code
)
values
  ('90000000-0000-4000-8000-0000000000a1',
   '11111111-1111-1111-1111-111111111111',
   '00000000-0000-4000-8000-000000000001',
   '50000000-0000-4000-8000-000000000001',
   '{"line1":"12, Gandhi Road","pincode":"572130"}'::jsonb,
   'placed', 'cod', 'pending', 25800, 2500, 0, 28300,
   date '2020-04-02' + time '09:00', null, null),
  ('90000000-0000-4000-8000-0000000000a2',
   '22222222-2222-2222-2222-222222222222',
   '00000000-0000-4000-8000-000000000001',
   '50000000-0000-4000-8000-000000000001',
   '{"line1":"8, Temple Street","pincode":"572130"}'::jsonb,
   'placed', 'cod', 'pending', 7000, 2500, 6000, 3500,
   date '2020-04-02' + time '09:30', null, 'SAVE10'),
  ('90000000-0000-4000-8000-0000000000a3',
   '11111111-1111-1111-1111-111111111111',
   '00000000-0000-4000-8000-000000000001',
   '50000000-0000-4000-8000-000000000001',
   '{"line1":"12, Gandhi Road","pincode":"572130"}'::jsonb,
   'delivered', 'cod', 'paid', 3600, 2500, 0, 6100,
   date '2020-04-02' + time '10:00', date '2020-04-02' + time '11:00', null),
  ('90000000-0000-4000-8000-0000000000a4',
   '11111111-1111-1111-1111-111111111111',
   '00000000-0000-4000-8000-000000000001',
   '50000000-0000-4000-8000-000000000001',
   '{"line1":"12, Gandhi Road","pincode":"572130"}'::jsonb,
   'out_for_delivery', 'cod', 'pending', 5200, 2500, 0, 7700,
   date '2020-04-02' + time '11:30', null, null),
  ('90000000-0000-4000-8000-0000000000a5',
   '11111111-1111-1111-1111-111111111111',
   '00000000-0000-4000-8000-000000000001',
   '50000000-0000-4000-8000-000000000001',
   '{"line1":"12, Gandhi Road","pincode":"572130"}'::jsonb,
   'cancelled', 'cod', 'pending', 4400, 2500, 0, 6900,
   date '2020-04-02' + time '12:00', null, null),
  ('90000000-0000-4000-8000-0000000000a6',
   '11111111-1111-1111-1111-111111111111',
   '00000000-0000-4000-8000-000000000001',
   '50000000-0000-4000-8000-000000000001',
   '{"line1":"12, Gandhi Road","pincode":"572130"}'::jsonb,
   'placed', 'cod', 'pending', 3600, 2500, 0, 6100,
   date '2020-04-02' + time '12:30', null, null);

-- -----------------------------------------------------------------------------
-- 2. The shelf and the lines, as the table owner: data, not the thing under
--    test. The shelf is SET, not assumed — earlier suites leave it wherever
--    they left it, and the line guard copies the price from the products row.
-- -----------------------------------------------------------------------------
reset role;

update public.products
   set stock_qty = 40, is_active = true, price_paise = 1800
 where id = '20000000-0000-4000-8000-000000000001';
update public.products
   set stock_qty = 60, is_active = true, price_paise = 2600
 where id = '20000000-0000-4000-8000-000000000002';

insert into public.order_items (
  id, order_id, product_id, product_name_en, product_name_kn,
  unit, price_paise, quantity
)
values
  ('90000000-0000-4000-8000-0000000001a1',
   '90000000-0000-4000-8000-0000000000a1',
   '20000000-0000-4000-8000-000000000001', 'Tomato', 'ಟೊಮೆಟೊ', '500 g', 1800, 10),
  ('90000000-0000-4000-8000-0000000001a2',
   '90000000-0000-4000-8000-0000000000a1',
   '20000000-0000-4000-8000-000000000002', 'Onion', 'ಈರುಳ್ಳಿ', '1 kg', 2600, 3),
  ('90000000-0000-4000-8000-0000000002a1',
   '90000000-0000-4000-8000-0000000000a2',
   '20000000-0000-4000-8000-000000000001', 'Tomato', 'ಟೊಮೆಟೊ', '500 g', 1800, 1),
  ('90000000-0000-4000-8000-0000000002a2',
   '90000000-0000-4000-8000-0000000000a2',
   '20000000-0000-4000-8000-000000000002', 'Onion', 'ಈರುಳ್ಳಿ', '1 kg', 2600, 2),
  ('90000000-0000-4000-8000-0000000003a1',
   '90000000-0000-4000-8000-0000000000a3',
   '20000000-0000-4000-8000-000000000001', 'Tomato', 'ಟೊಮೆಟೊ', '500 g', 1800, 2),
  ('90000000-0000-4000-8000-0000000004a1',
   '90000000-0000-4000-8000-0000000000a4',
   '20000000-0000-4000-8000-000000000002', 'Onion', 'ಈರುಳ್ಳಿ', '1 kg', 2600, 2),
  ('90000000-0000-4000-8000-0000000005a1',
   '90000000-0000-4000-8000-0000000000a5',
   '20000000-0000-4000-8000-000000000001', 'Tomato', 'ಟೊಮೆಟೊ', '500 g', 1800, 1),
  ('90000000-0000-4000-8000-0000000005a2',
   '90000000-0000-4000-8000-0000000000a5',
   '20000000-0000-4000-8000-000000000002', 'Onion', 'ಈರುಳ್ಳಿ', '1 kg', 2600, 1),
  ('90000000-0000-4000-8000-0000000006a1',
   '90000000-0000-4000-8000-0000000000a6',
   '20000000-0000-4000-8000-000000000001', 'Tomato', 'ಟೊಮೆಟೊ', '500 g', 1800, 2);

select test_result.eq(
  'fixture: the shelf starts at 40 tomatoes',
  (select stock_qty from public.products where id = '20000000-0000-4000-8000-000000000001'),
  40
);
select test_result.eq(
  'fixture: the shelf starts at 60 onions',
  (select stock_qty from public.products where id = '20000000-0000-4000-8000-000000000002'),
  60
);
select test_result.eq(
  'fixture: the delivered order really is delivered (the guard did not reset it)',
  (select status::text from public.orders
    where id = '90000000-0000-4000-8000-0000000000a3'),
  'delivered'
);

-- =============================================================================
-- 3. The door: only the shop.
-- =============================================================================
set role authenticated;
select test_result.sign_in('11111111-1111-1111-1111-111111111111');   -- Asha (customer)

select test_result.refused(
  'a customer cannot adjust a line on any order',
  $$ select public.admin_adjust_order_item(
       '90000000-0000-4000-8000-0000000000a1',
       '90000000-0000-4000-8000-0000000001a1', 6) $$,
  '42501'
);

select test_result.sign_out();
select test_result.sign_in('44444444-4444-4444-4444-444444444444');   -- the rider

select test_result.refused(
  'a rider cannot adjust a line either',
  $$ select public.admin_adjust_order_item(
       '90000000-0000-4000-8000-0000000000a1',
       '90000000-0000-4000-8000-0000000001a1', 6) $$,
  '42501'
);

-- =============================================================================
-- 4. Unknown rows are refused, never ignored.
-- =============================================================================
select test_result.sign_out();
select test_result.sign_in('33333333-3333-3333-3333-333333333333');   -- Owner

select test_result.refused(
  'an unknown order is refused',
  $$ select public.admin_adjust_order_item(
       '99999999-9999-4999-8999-999999999999',
       '90000000-0000-4000-8000-0000000001a1', 6) $$,
  'P0002'
);

select test_result.refused(
  'a line that is not on this order is refused',
  $$ select public.admin_adjust_order_item(
       '90000000-0000-4000-8000-0000000000a1',
       '90000000-0000-4000-8000-0000000006a1', 6) $$,
  'P0002'
);

-- =============================================================================
-- 5. Nonsense quantities are refused.
-- =============================================================================
select test_result.refused(
  'a NULL quantity is refused',
  $$ select public.admin_adjust_order_item(
       '90000000-0000-4000-8000-0000000000a1',
       '90000000-0000-4000-8000-0000000001a1', null) $$,
  'P0001'
);

select test_result.refused(
  'a negative quantity is refused',
  $$ select public.admin_adjust_order_item(
       '90000000-0000-4000-8000-0000000000a1',
       '90000000-0000-4000-8000-0000000001a1', -1) $$,
  'P0001'
);

select test_result.refused(
  'more than 99 packs is refused, as at checkout',
  $$ select public.admin_adjust_order_item(
       '90000000-0000-4000-8000-0000000000a1',
       '90000000-0000-4000-8000-0000000001a1', 100) $$,
  'P0001'
);

-- =============================================================================
-- 6. A bag that has left the shop is a fact. Each probe is sharp: the
--    quantity asked for is neither idempotent nor the last-line case, so the
--    refusal can only be the status check.
-- =============================================================================
select test_result.refused(
  'a delivered order cannot be adjusted',
  $$ select public.admin_adjust_order_item(
       '90000000-0000-4000-8000-0000000000a3',
       '90000000-0000-4000-8000-0000000003a1', 1) $$,
  'P0001'
);

select test_result.refused(
  'an order out for delivery cannot be adjusted — the rider counted that bag',
  $$ select public.admin_adjust_order_item(
       '90000000-0000-4000-8000-0000000000a4',
       '90000000-0000-4000-8000-0000000004a1', 1) $$,
  'P0001'
);

select test_result.refused(
  'a cancelled order cannot be adjusted',
  $$ select public.admin_adjust_order_item(
       '90000000-0000-4000-8000-0000000000a5',
       '90000000-0000-4000-8000-0000000005a1', 0) $$,
  'P0001'
);

-- =============================================================================
-- 7. An increase is not an adjustment. (The probe below was the call that
--    poisoned the first draft: the header promised it, the code had to say it.)
-- =============================================================================
select test_result.refused(
  'a shortage means less: 10 cannot become 11',
  $$ select public.admin_adjust_order_item(
       '90000000-0000-4000-8000-0000000000a1',
       '90000000-0000-4000-8000-0000000001a1', 11) $$,
  'P0001'
);

-- =============================================================================
-- 8. The shortage itself: 10 packs become 6, the books agree, 4 go back.
--    1800×6 + 2600×3 = 18600; + fee 2500 = 21100.
-- =============================================================================
select public.admin_adjust_order_item(
  '90000000-0000-4000-8000-0000000000a1',
  '90000000-0000-4000-8000-0000000001a1', 6);

select test_result.eq(
  'the reduced order recomputes the subtotal from the remaining lines',
  (select subtotal_paise from public.orders
    where id = '90000000-0000-4000-8000-0000000000a1'),
  18600
);
select test_result.eq(
  'and the total follows the subtotal',
  (select total_paise from public.orders
    where id = '90000000-0000-4000-8000-0000000000a1'),
  21100
);
select test_result.eq(
  'the 4 released packs are back on the shelf',
  (select stock_qty from public.products
    where id = '20000000-0000-4000-8000-000000000001'),
  44
);

-- The snapshot columns are NOT the shortage: only the count changed.
select test_result.eq(
  'the line''s price snapshot survives the adjustment',
  (select price_paise from public.order_items
    where id = '90000000-0000-4000-8000-0000000001a1'),
  1800
);
select test_result.eq(
  'and its name snapshot too',
  (select product_name_en from public.order_items
    where id = '90000000-0000-4000-8000-0000000001a1'),
  'Tomato'
);

-- =============================================================================
-- 9. The customer still reads her own order and its lines.
-- =============================================================================
select test_result.sign_out();
select test_result.sign_in('11111111-1111-1111-1111-111111111111');   -- Asha

select test_result.eq(
  'the customer reads her adjusted total',
  (select total_paise from public.orders
    where id = '90000000-0000-4000-8000-0000000000a1'),
  21100
);
select test_result.eq(
  'and both of her lines (the second is still on the order)',
  (select count(*) from public.order_items
    where order_id = '90000000-0000-4000-8000-0000000000a1'),
  2
);

-- =============================================================================
-- 10. Quantity 0 takes a line off — but never the last one.
-- =============================================================================
select test_result.sign_out();
select test_result.sign_in('33333333-3333-3333-3333-333333333333');   -- Owner

select public.admin_adjust_order_item(
  '90000000-0000-4000-8000-0000000000a1',
  '90000000-0000-4000-8000-0000000001a2', 0);

select test_result.eq(
  'taking the onion line off leaves one line',
  (select count(*) from public.order_items
    where order_id = '90000000-0000-4000-8000-0000000000a1'),
  1
);
select test_result.eq(
  'the subtotal is the tomato line alone',
  (select subtotal_paise from public.orders
    where id = '90000000-0000-4000-8000-0000000000a1'),
  10800
);
select test_result.eq(
  'and the total follows: 10800 + 2500 fee',
  (select total_paise from public.orders
    where id = '90000000-0000-4000-8000-0000000000a1'),
  13300
);
select test_result.eq(
  'the 3 onions are back on the shelf',
  (select stock_qty from public.products
    where id = '20000000-0000-4000-8000-000000000002'),
  63
);

select test_result.refused(
  'the last line is not an adjustment — it is a cancellation',
  $$ select public.admin_adjust_order_item(
       '90000000-0000-4000-8000-0000000000a6',
       '90000000-0000-4000-8000-0000000006a1', 0) $$,
  'P0001'
);

-- =============================================================================
-- 11. A repeat of the same call changes nothing.
-- =============================================================================
select public.admin_adjust_order_item(
  '90000000-0000-4000-8000-0000000000a1',
  '90000000-0000-4000-8000-0000000001a1', 6);

select test_result.eq(
  'the retry moved no stock (still 44, not 45)',
  (select stock_qty from public.products
    where id = '20000000-0000-4000-8000-000000000001'),
  44
);
select test_result.eq(
  'and recomputed nothing (the books still say 10800)',
  (select subtotal_paise from public.orders
    where id = '90000000-0000-4000-8000-0000000000a1'),
  10800
);

-- =============================================================================
-- 12. A coupon larger than the reduced basket is refused — loudly, and
--     BEFORE anything moves. Ravi's order: 7000 subtotal, 6000 discount.
--     Taking the BIG line off leaves 1800 + 2500 - 6000 = -1700.
-- =============================================================================
select test_result.refused(
  'the coupon would exceed the basket: refused, not left to the CHECK constraint',
  $$ select public.admin_adjust_order_item(
       '90000000-0000-4000-8000-0000000000a2',
       '90000000-0000-4000-8000-0000000002a2', 0) $$,
  'P0001'
);

select test_result.eq(
  'the refusal moved no stock on the way out',
  (select stock_qty from public.products
    where id = '20000000-0000-4000-8000-000000000002'),
  63
);

-- The rule is arithmetic, not a blanket: taking the SMALL line off instead
-- leaves 5200 + 2500 - 6000 = 1700, which is a real total.
select public.admin_adjust_order_item(
  '90000000-0000-4000-8000-0000000000a2',
  '90000000-0000-4000-8000-0000000002a1', 0);

select test_result.eq(
  'the smaller reduction is allowed: subtotal 5200',
  (select subtotal_paise from public.orders
    where id = '90000000-0000-4000-8000-0000000000a2'),
  5200
);
select test_result.eq(
  'and the stored discount is carried, so the total is 1700',
  (select total_paise from public.orders
    where id = '90000000-0000-4000-8000-0000000000a2'),
  1700
);
select test_result.eq(
  'the one tomato went back: 44 + 1',
  (select stock_qty from public.products
    where id = '20000000-0000-4000-8000-000000000001'),
  45
);

-- =============================================================================
-- 13. The direct doors are gone.
--
-- A direct UPDATE now matches ZERO rows and raises NOTHING (that is RLS
-- filtering, and exactly why the function raises instead) — so the proof is
-- that nothing changed, not that an error came back.
-- =============================================================================
select test_result.touches(
  'an admin''s direct UPDATE on a line matches zero rows',
  $$ update public.order_items set quantity = 1
     where id = '90000000-0000-4000-8000-0000000001a1' $$,
  0
);
select test_result.eq(
  'and the line is unchanged',
  (select quantity from public.order_items
    where id = '90000000-0000-4000-8000-0000000001a1'),
  6
);

select test_result.touches(
  'an admin''s direct DELETE on a line matches zero rows',
  $$ delete from public.order_items
     where id = '90000000-0000-4000-8000-0000000001a1' $$,
  0
);
select test_result.eq(
  'and the line still exists',
  (select count(*) from public.order_items
    where id = '90000000-0000-4000-8000-0000000001a1'),
  1
);

select test_result.eq(
  'the write policies are gone; only the read remains',
  (select count(*) from pg_policies
    where schemaname = 'public' and tablename = 'order_items'),
  1
);
select test_result.eq(
  'and the survivor is the SELECT policy',
  (select count(*) from pg_policies
    where schemaname = 'public' and tablename = 'order_items'
      and cmd = 'SELECT'),
  1
);

-- =============================================================================
-- 14. Put the fixtures back.
-- =============================================================================
reset role;

delete from public.order_items
  where order_id::text like '90000000-0000-4000-8000-%';

delete from public.orders
  where id::text like '90000000-0000-4000-8000-%';

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
