-- =============================================================================
-- 01 · Existing rules still hold, and the new "no direct order inserts" rule.
--
-- These are regression tests. If a later migration quietly loosens something,
-- this is the file that notices.
-- =============================================================================

select test_result.begin_suite('01 baseline RLS');

set role authenticated;
select test_result.sign_out();

-- -----------------------------------------------------------------------------
-- Browsing
-- -----------------------------------------------------------------------------

select test_result.eq(
  'a signed-out visitor sees every active product (34 seeded + 1 test product)',
  (select count(*) from public.products where is_active),
  35
);

select test_result.eq(
  'a signed-out visitor cannot see the hidden paneer row',
  (select count(*) from public.products where not is_active),
  0
);

set role anon;

select test_result.ok(
  'anon can still read the shop list',
  exists (select 1 from public.stores where id = '00000000-0000-4000-8000-000000000001')
);

-- -----------------------------------------------------------------------------
-- Addresses are strictly per-customer
-- -----------------------------------------------------------------------------

set role authenticated;
select test_result.sign_in('11111111-1111-1111-1111-111111111111');

select test_result.eq(
  'Asha sees only her own 3 addresses',
  (select count(*) from public.addresses),
  3
);

select test_result.eq(
  'Asha cannot see Ravi''s address',
  (select count(*) from public.addresses
   where id = '50000000-0000-4000-8000-000000000004'),
  0
);

-- DELETE does not raise, it just matches nothing. See test_result.touches.
select test_result.touches(
  'Asha cannot delete Ravi''s address (0 rows touched)',
  $$delete from public.addresses where id = '50000000-0000-4000-8000-000000000004'$$,
  0
);

-- -----------------------------------------------------------------------------
-- Nobody promotes themselves
-- -----------------------------------------------------------------------------

select test_result.refused(
  'Asha cannot make herself admin',
  $$update public.profiles set role = 'admin' where id = '11111111-1111-1111-1111-111111111111'$$,
  '42501'
);

select test_result.eq(
  'Asha is still a customer after trying',
  (select role::text from public.profiles where id = '11111111-1111-1111-1111-111111111111'),
  'customer'
);

-- -----------------------------------------------------------------------------
-- NEW: an order can only be created through place_order()
-- -----------------------------------------------------------------------------

select test_result.refused(
  'a customer cannot INSERT an order directly',
  $$
  insert into public.orders (
    user_id, store_id, address_id, delivery_address,
    payment_method, payment_status,
    subtotal_paise, delivery_fee_paise, discount_paise, total_paise
  ) values (
    '11111111-1111-1111-1111-111111111111',
    '00000000-0000-4000-8000-000000000001',
    '50000000-0000-4000-8000-000000000001',
    '{}'::jsonb,
    'cod', 'paid',
    1, 0, 0, 1
  )
  $$,
  '42501'
);

select test_result.eq(
  'that direct insert really created nothing',
  (select count(*) from public.orders),
  0
);

select test_result.refused(
  'a customer cannot INSERT an order item directly (a fake price)',
  $$
  insert into public.order_items (order_id, product_id, price_paise, quantity)
  values (
    gen_random_uuid(),
    '20000000-0000-4000-8000-000000000001',
    1,
    99
  )
  $$,
  '42501'
);

-- There are no orders yet, but the point stands: an UPDATE aimed at somebody
-- else's row changes nothing rather than erroring. File 03 repeats this against
-- a real order, which is the assertion that actually matters.
select test_result.touches(
  'a customer UPDATE aimed at an order changes 0 rows',
  $$
  update public.orders
  set total_paise = 1, subtotal_paise = 1
  where id = gen_random_uuid()
  $$,
  0
);

-- -----------------------------------------------------------------------------
-- Staff powers and limits
-- -----------------------------------------------------------------------------

select test_result.sign_in('44444444-4444-4444-4444-444444444444');

select test_result.touches(
  'the rider cannot change a product price (0 rows touched)',
  $$
  update public.products
  set price_paise = 1
  where id = '20000000-0000-4000-8000-000000000001'
  $$,
  0
);

select test_result.ok(
  'the rider cannot read another customer''s addresses',
  not exists (select 1 from public.addresses where user_id = '11111111-1111-1111-1111-111111111111')
);

-- -----------------------------------------------------------------------------
-- Function execution grants
-- -----------------------------------------------------------------------------

set role anon;

select test_result.refused(
  'anon cannot call place_order',
  $$
  select public.place_order('[]'::jsonb, gen_random_uuid(), gen_random_uuid(), 'anon-attempt-0001')
  $$,
  '42501'
);

set role authenticated;
select test_result.sign_in('44444444-4444-4444-4444-444444444444');

select test_result.ok(
  'a signed-in customer CAN call place_order',
  (public.place_order(
     '[{"product_id":"20000000-0000-4000-8000-000000000001","quantity":1}]',
     '00000000-0000-4000-8000-000000000001',
     '50000000-0000-4000-8000-000000000001',
     'not-logged-in-probe-0001'
   ) ->> 'error') = 'address_not_found'
);

select test_result.sign_out();

reset role;