-- =============================================================================
-- 42 · The invoice number follows the financial year of TODAY, not of the test
-- =============================================================================
-- WHAT THE DIRECTIVE ASKS
-- -----------------------
-- "A test order created now must get a 2026-27 prefix." Today is November
-- 2026, inside the Indian financial year that runs 1 April 2026 – 31 March
-- 2027, so the prefix is INV/2026-27/…
--
-- WHY THE NUMBER IS WHAT IT IS
-- ----------------------------
-- `orders_billing_defaults()` (migration 20261112000001) is a BEFORE-INSERT
-- trigger: EVERY order receives `INV/<financial year>/<6-digit serial>` the
-- moment the row is written, from `coalesce(placed_at, now())` — before any
-- invoice is ever printed, so a document can never exist without a number,
-- and the books are continuous from the shop's first order (one global
-- sequence, filled oldest-first at the backfill).
--
-- THE FINANCIAL YEAR IS INDIAN, IN IST: April through December reads
-- `YYYY-(YY+1)`; January through March reads `(YYYY-1)-YY`. Test 36 pins the
-- label function itself. THIS suite pins the other half of the promise with
-- REAL orders: the BEFORE-INSERT trigger feeding
-- `coalesce(placed_at, now())` into that label. Section 3 stamps two orders one
-- second apart — 2027-03-31 23:59:59 IST and 2027-04-01 00:00:00 IST — so the
-- year flips on the second it should and not the one before or after.
--
-- WHAT HAPPENS TO A CANCELLED ORDER'S NUMBER
-- ------------------------------------------
-- Nothing. The number is assigned at insert and never rewritten (the column
-- comment says so; the trigger only fills a NULL). Cancelling does not void
-- it, and no later order may take it — a document number that could be
-- reused would make the shop's books unreadable, and GST practice forbids
-- reissuing a number. The invoice document itself still renders for a
-- cancelled order (`order_invoice()` has no status refusal): the cancelled
-- order is part of the ledger, and its paper says what was ordered before it
-- was stopped. A serial can also go missing entirely when an insert ROLLS
-- BACK — `nextval()` is not transactional — which is an honest gap in the
-- ledger, the same way a torn bill of supply is.
--
-- The expected prefix is computed from `financial_year_label(now())` rather
-- than hard-coded, so this suite stays true when the calendar moves — and
-- today that label is exactly 2026-27.
-- =============================================================================

select test_result.begin_suite('42 invoice financial year');

reset role;

-- The shelf is SET, not assumed: the line guard copies the price from the
-- products row, and earlier suites leave stock wherever they left it.
update public.products
   set stock_qty = 40, is_active = true, price_paise = 1800
 where id = '20000000-0000-4000-8000-000000000001';
update public.products
   set stock_qty = 60, is_active = true, price_paise = 2600
 where id = '20000000-0000-4000-8000-000000000002';

-- The order, as the signed-in owner, so `guard_order_insert` leaves the
-- status alone (the fixture trick test 34 and suite 41 document). The LINES
-- go in as the table owner afterwards — suite 41's pattern: the order is the
-- guarded thing, the lines are data.
set role authenticated;
select test_result.sign_in('33333333-3333-3333-3333-333333333333');   -- Owner

insert into public.orders (
  id, user_id, store_id, address_id, delivery_address,
  status, payment_method, payment_status,
  subtotal_paise, delivery_fee_paise, discount_paise, total_paise,
  placed_at
)
values (
  '92000000-0000-4000-8000-0000000000a1',
  '11111111-1111-1111-1111-111111111111',
  '00000000-0000-4000-8000-000000000001',
  '50000000-0000-4000-8000-000000000001',
  '{"line1":"12, Gandhi Road","pincode":"572130"}'::jsonb,
  'placed', 'cod', 'pending', 10800, 2500, 0, 13300,
  now()
);

-- The lines, as the table owner (no admin INSERT policy exists on
-- order_items — the definer place_order() is the normal write path).
reset role;

insert into public.order_items (
  id, order_id, product_id, product_name_en, product_name_kn,
  unit, price_paise, quantity
)
values (
  '92000000-0000-4000-8000-0000000001a1',
  '92000000-0000-4000-8000-0000000000a1',
  '20000000-0000-4000-8000-000000000001', 'Tomato', 'ಟೊಮೆಟೊ', '500 g', 1800, 6
);

-- Back to the owner for the cancel, which is an admin session's work.
set role authenticated;
select test_result.sign_in('33333333-3333-3333-3333-333333333333');   -- Owner

-- -----------------------------------------------------------------------------
-- 1. The order created NOW carries the financial year of NOW.
-- -----------------------------------------------------------------------------
select test_result.ok(
  'an order created now carries the financial year of now '
  || '(today that is 2026-27)',
  (select invoice_number from public.orders
    where id = '92000000-0000-4000-8000-0000000000a1')
    like 'INV/' || public.financial_year_label(now()) || '/%',
  (select invoice_number from public.orders
    where id = '92000000-0000-4000-8000-0000000000a1')
);

select test_result.ok(
  'and the serial is six digits',
  (select invoice_number from public.orders
    where id = '92000000-0000-4000-8000-0000000000a1')
    ~ ('^INV/' || public.financial_year_label(now()) || '/[0-9]{6}$')
);

-- -----------------------------------------------------------------------------
-- 2. A cancelled order KEEPS its number, and no later order takes it.
-- -----------------------------------------------------------------------------
do $$
declare
  v_before text;
begin
  select invoice_number into v_before
    from public.orders
   where id = '92000000-0000-4000-8000-0000000000a1';

  perform public.admin_cancel_order(
    '92000000-0000-4000-8000-0000000000a1',
    'customer asked by phone');

  perform test_result.ok(
    'the cancelled order still carries the number it was given',
    (select invoice_number from public.orders
      where id = '92000000-0000-4000-8000-0000000000a1') = v_before
    and v_before is not null,
    coalesce(v_before, 'null'));
end;
$$;

insert into public.orders (
  id, user_id, store_id, address_id, delivery_address,
  status, payment_method, payment_status,
  subtotal_paise, delivery_fee_paise, discount_paise, total_paise,
  placed_at
)
values (
  '92000000-0000-4000-8000-0000000000a2',
  '11111111-1111-1111-1111-111111111111',
  '00000000-0000-4000-8000-000000000001',
  '50000000-0000-4000-8000-000000000001',
  '{"line1":"12, Gandhi Road","pincode":"572130"}'::jsonb,
  'placed', 'cod', 'pending', 10800, 2500, 0, 13300,
  now()
);

select test_result.ok(
  'the next order gets the NEXT serial — a cancelled number is never reused',
  (select invoice_number from public.orders
    where id = '92000000-0000-4000-8000-0000000000a2')
    <> (select invoice_number from public.orders
          where id = '92000000-0000-4000-8000-0000000000a1')
  and (select invoice_number from public.orders
         where id = '92000000-0000-4000-8000-0000000000a2')
    like 'INV/' || public.financial_year_label(now()) || '/%'
);

-- -----------------------------------------------------------------------------
-- 3. THE EXACT BOUNDARY: 31 March 23:59:59 IST against 1 April 00:00:00 IST.
--
-- Test 36 pins the label function a few minutes either side of the Indian
-- rollover. This suite pins the other half of the machinery with REAL orders
-- stamped one second apart: the BEFORE-INSERT trigger feeding
-- `coalesce(placed_at, now())` into the label. The whole audit risk in an
-- invoice number is the year, so the year is pinned to the second, in both
-- directions — the rollover just passed and the one coming next.
-- -----------------------------------------------------------------------------

insert into public.orders (
  id, user_id, store_id, address_id, delivery_address,
  status, payment_method, payment_status,
  subtotal_paise, delivery_fee_paise, discount_paise, total_paise,
  placed_at
)
values
  ('92000000-0000-4000-8000-0000000000a3',
   '11111111-1111-1111-1111-111111111111',
   '00000000-0000-4000-8000-000000000001',
   '50000000-0000-4000-8000-000000000001',
   '{"line1":"12, Gandhi Road","pincode":"572130"}'::jsonb,
   'placed', 'cod', 'pending', 10800, 2500, 0, 13300,
   '2027-03-31 23:59:59+05:30'::timestamptz),

  ('92000000-0000-4000-8000-0000000000a4',
   '11111111-1111-1111-1111-111111111111',
   '00000000-0000-4000-8000-000000000001',
   '50000000-0000-4000-8000-000000000001',
   '{"line1":"12, Gandhi Road","pincode":"572130"}'::jsonb,
   'placed', 'cod', 'pending', 10800, 2500, 0, 13300,
   '2027-04-01 00:00:00+05:30'::timestamptz);

select test_result.ok(
  'an order stamped 31 March 2027 23:59:59 IST is invoiced in 2026-27',
  (select invoice_number from public.orders
    where id = '92000000-0000-4000-8000-0000000000a3')
    like 'INV/2026-27/%',
  (select invoice_number from public.orders
    where id = '92000000-0000-4000-8000-0000000000a3')
);

select test_result.ok(
  'an order stamped 1 April 2027 00:00:00 IST is invoiced in 2027-28',
  (select invoice_number from public.orders
    where id = '92000000-0000-4000-8000-0000000000a4')
    like 'INV/2027-28/%',
  (select invoice_number from public.orders
    where id = '92000000-0000-4000-8000-0000000000a4')
);

select test_result.ok(
  'and the two orders are one second apart, in different years',
  (select invoice_number from public.orders
    where id = '92000000-0000-4000-8000-0000000000a3')
  <> (select invoice_number from public.orders
        where id = '92000000-0000-4000-8000-0000000000a4')
);

select test_result.ok(
  'the serial still moves forward, one document number per order',
  (select split_part(invoice_number, '/', 3)::bigint from public.orders
    where id = '92000000-0000-4000-8000-0000000000a4')
  > (select split_part(invoice_number, '/', 3)::bigint from public.orders
        where id = '92000000-0000-4000-8000-0000000000a3')
);

select test_result.ok(
  'the label function itself agrees at the exact second, both directions',
  public.financial_year_label('2027-03-31 23:59:59+05:30'::timestamptz) = '2026-27'
  and public.financial_year_label('2027-04-01 00:00:00+05:30'::timestamptz) = '2027-28'
  and public.financial_year_label('2026-03-31 23:59:59+05:30'::timestamptz) = '2025-26'
  and public.financial_year_label('2026-04-01 00:00:00+05:30'::timestamptz) = '2026-27',
  public.financial_year_label('2027-03-31 23:59:59+05:30'::timestamptz)
  || '/' || public.financial_year_label('2027-04-01 00:00:00+05:30'::timestamptz)
  || '/' || public.financial_year_label('2026-03-31 23:59:59+05:30'::timestamptz)
  || '/' || public.financial_year_label('2026-04-01 00:00:00+05:30'::timestamptz)
);

-- -----------------------------------------------------------------------------
-- 4. Put the fixtures back.
-- -----------------------------------------------------------------------------
reset role;

delete from public.order_items
  where order_id::text like '92000000-%';
delete from public.orders
  where id::text like '92000000-%';

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
