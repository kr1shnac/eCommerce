-- =============================================================================
-- 12 · demo.sql — the dev data loader, and the guard it borrows.
--
-- demo.sql exists so all three faces (customer, rider, owner) can be LOOKED AT
-- with real-looking data instead of empty states. That makes it worth testing,
-- for two reasons:
--
--   1. It writes orders directly, so it briefly disables `orders_guard_insert`.
--      A dev tool that leaves a security trigger switched OFF is far worse than
--      no dev tool at all. The most important assertion in this file is simply
--      that the trigger is back on afterwards.
--   2. The whole point is that the numbers add up (rule 9.1), each order has
--      items, and each order snapshots an address — if any of that is wrong the
--      screens it exists to fill will show something broken instead of fixed.
--
-- It runs against the fixtures: Asha is the first customer, and the fixture
-- "Rider" is the only delivery profile, so the orders can be assigned.
-- =============================================================================

\ir ../demo.sql

select test_result.begin_suite('12 demo data');

-- -----------------------------------------------------------------------------
-- The order shape. Scoped to the demo orders (order_number 'KNG-D%') so the
-- orders created by earlier test files are not counted.
-- -----------------------------------------------------------------------------

select test_result.eq(
  'demo.sql created 8 orders',
  (select count(*) from public.orders where order_number like 'KNG-D%'),
  8
);

select test_result.eq(
  'demo.sql made 24 order lines',
  (select count(*) from public.order_items i
     join public.orders o on o.id = i.order_id
    where o.order_number like 'KNG-D%'),
  24
);

select test_result.eq(
  '2 orders are waiting for a rider (unclaimed, placed/confirmed)',
  (select count(*) from public.orders
    where order_number like 'KNG-D%' and assigned_to is null
      and status in ('placed', 'confirmed')),
  2
);

select test_result.eq(
  '3 orders are assigned and in progress',
  (select count(*) from public.orders
    where order_number like 'KNG-D%'
      and status in ('confirmed', 'packing', 'out_for_delivery')
      and assigned_to = '44444444-4444-4444-4444-444444444444'),
  3
);

select test_result.eq(
  '2 orders were delivered, 1 was cancelled',
  (select count(*) from public.orders
    where order_number like 'KNG-D%' and status = 'delivered'),
  2
);

select test_result.eq(
  'exactly 1 order was cancelled',
  (select count(*) from public.orders
    where order_number like 'KNG-D%' and status = 'cancelled'),
  1
);

-- -----------------------------------------------------------------------------
-- The money adds up, and every order has lines and an address (rule 9.1).
-- -----------------------------------------------------------------------------

select test_result.eq(
  'every demo order total = subtotal + fee - discount',
  (select count(*) from public.orders
    where order_number like 'KNG-D%'
      and total_paise <> subtotal_paise + delivery_fee_paise - discount_paise),
  0
);

select test_result.eq(
  'every demo order subtotal equals the sum of its line totals',
  (select count(*) from (
     select o.id
       from public.orders o
       join public.order_items i on i.order_id = o.id
      where o.order_number like 'KNG-D%'
      group by o.id, o.subtotal_paise
     having sum(i.line_total_paise) <> o.subtotal_paise
   ) bad),
  0
);

select test_result.eq(
  'every demo order has at least one line',
  (select count(*) from public.orders o
    where o.order_number like 'KNG-D%'
      and not exists (select 1 from public.order_items i where i.order_id = o.id)),
  0
);

select test_result.eq(
  'every demo order snapshots the Kunigal address',
  (select count(*) from public.orders
    where order_number like 'KNG-D%' and delivery_address ->> 'pincode' = '572130'),
  8
);

select test_result.eq(
  'the demo fee is the zone fee (Rs 15)',
  (select count(*) from public.orders
    where order_number like 'KNG-D%' and delivery_fee_paise = 1500),
  8
);

-- Asha already had an address from the fixtures, so demo.sql must NOT have
-- invented a second one.
select test_result.eq(
  'demo.sql reused the existing address instead of adding one',
  (select count(*) from public.addresses
    where user_id = '11111111-1111-1111-1111-111111111111'),
  3
);

-- -----------------------------------------------------------------------------
-- The safety assertion: the guard trigger is ENABLED again.
-- tgenabled = 'O' means "enabled, fires in origin mode". Anything else means the
-- loader left a hole behind.
-- -----------------------------------------------------------------------------

select test_result.eq(
  'orders_guard_insert is enabled again after demo.sql',
  (select tgenabled::text from pg_trigger where tgname = 'orders_guard_insert'),
  'O'
);

select test_result.eq(
  'order_items_guard_insert is enabled again after demo.sql',
  (select tgenabled::text from pg_trigger where tgname = 'order_items_guard_insert'),
  'O'
);

-- And it still bites. A customer cannot insert an order at all through RLS (the
-- policy was dropped in migration 08 — place_order() is the only door), so to
-- test the TRIGGER itself we run as the table owner, which bypasses RLS, and
-- sign in as a customer. An insert of a born-delivered order is then forced
-- back to placed/pending. This is the same check test 03 makes.
select test_result.sign_in('22222222-2222-2222-2222-222222222222');  -- Ravi, a customer

do $$
declare
  v_id uuid;
begin
  insert into public.orders (
    user_id, store_id, status, payment_method, payment_status,
    subtotal_paise, delivery_fee_paise, discount_paise, total_paise,
    idempotency_key
  ) values (
    '22222222-2222-2222-2222-222222222222', '00000000-0000-4000-8000-000000000001',
    'delivered', 'cod', 'paid', 1000, 0, 0, 1000, 'guard-check-1234'
  ) returning id into v_id;

  perform test_result.eq(
    'a customer still cannot create a delivered order (the guard bites)',
    (select status::text from public.orders where id = v_id),
    'placed'
  );
end $$;

select test_result.sign_out();

-- -----------------------------------------------------------------------------
-- The customer can actually SEE the history, through RLS. This is the real
-- question the file exists to answer: will the Orders tab be populated?
-- -----------------------------------------------------------------------------

set role authenticated;
select test_result.sign_in('11111111-1111-1111-1111-111111111111');  -- Asha

select test_result.eq(
  'Asha can read all 8 demo orders through RLS',
  (select count(*) from public.orders where order_number like 'KNG-D%'),
  8
);

set role authenticated;
select test_result.sign_in('44444444-4444-4444-4444-444444444444');  -- the rider

select test_result.eq(
  'the rider can read the 2 waiting demo orders',
  (select count(*) from public.orders
    where order_number like 'KNG-D%' and assigned_to is null
      and status in ('placed', 'confirmed')),
  2
);

reset role;
