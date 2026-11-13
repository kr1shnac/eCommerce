-- =============================================================================
-- 43 Â· A rider's phone number is contact for the errand, not forever
-- =============================================================================
-- Migration 20261113000001 narrows `rider_directory` by TIME as well as by
-- visibility. The claims:
--
--   1. A rider on an order IN PROGRESS (placed, out_for_delivery â€” and by the
--      same rule confirmed and packing) is visible to the order's customer.
--   2. A rider on a DELIVERED order is visible for a short window â€” 24 hours
--      â€” and invisible afterwards. The delivery evening is contact time; the
--      next morning the shop is the door.
--   3. A rider on a CANCELLED, FAILED or RETURNED order is never visible to
--      the customer: the rider never handed the bag over, so the shop is the
--      contact. The order keeps its rider for the shop's own books.
--   4. The boundary is sharp: delivered EXACTLY 24 hours ago is already
--      outside (strictly greater than, so a boundary instant hides).
--   5. The owner sees every assigned rider ALWAYS â€” the window narrows the
--      customer's phone view, never the shop's work tools.
--
-- THE FIXTURE SHAPE: one rider per order. The view returns ONE row per RIDER
-- (the `exists` shape migration 20261112000008 chose), so a rider with two
-- orders â€” one live, one stale â€” would collapse both truths into one row and
-- the test would prove nothing. Six riders, six orders, six answers.
-- =============================================================================

select test_result.begin_suite('43 rider directory window');

reset role;

-- -----------------------------------------------------------------------------
-- 1. Six riders, as the table owner. auth.users first (handle_new_user()
--    creates the profile), then the role â€” the fixtures pattern.
-- -----------------------------------------------------------------------------
insert into auth.users (id, phone, raw_user_meta_data) values
  ('66666666-0000-4000-8000-0000000000a1', '+919800000011', '{"full_name":"Rider One"}'),
  ('66666666-0000-4000-8000-0000000000a2', '+919800000012', '{"full_name":"Rider Two"}'),
  ('66666666-0000-4000-8000-0000000000a3', '+919800000013', '{"full_name":"Rider Three"}'),
  ('66666666-0000-4000-8000-0000000000a4', '+919800000014', '{"full_name":"Rider Four"}'),
  ('66666666-0000-4000-8000-0000000000a5', '+919800000015', '{"full_name":"Rider Five"}'),
  ('66666666-0000-4000-8000-0000000000a6', '+919800000016', '{"full_name":"Rider Six"}'),
  ('66666666-0000-4000-8000-0000000000a7', '+919800000017', '{"full_name":"Rider Seven"}')
on conflict (id) do nothing;

update public.profiles
   set role = 'delivery'
 where id::text like '66666666-0000-4000-8000-0000000000a%';

-- -----------------------------------------------------------------------------
-- 2. Seven orders for Asha, one rider each, inserted AS THE SIGNED-IN OWNER so
--    `guard_order_insert` leaves the statuses alone (the fixture trick).
-- -----------------------------------------------------------------------------
set role authenticated;
select test_result.sign_in('33333333-3333-3333-3333-333333333333');   -- Owner

insert into public.orders (
  id, user_id, store_id, address_id, delivery_address,
  status, payment_method, payment_status,
  subtotal_paise, delivery_fee_paise, discount_paise, total_paise,
  placed_at, delivered_at, failure_reason,
  assigned_to, assigned_at
)
values
  ('93000000-0000-4000-8000-0000000000d1',
   '11111111-1111-1111-1111-111111111111',
   '00000000-0000-4000-8000-000000000001',
   '50000000-0000-4000-8000-000000000001',
   '{"line1":"12, Gandhi Road","pincode":"572130"}'::jsonb,
   'placed', 'cod', 'pending', 10800, 2500, 0, 13300,
   now(), null, null,
   '66666666-0000-4000-8000-0000000000a1', now()),
  ('93000000-0000-4000-8000-0000000000d2',
   '11111111-1111-1111-1111-111111111111',
   '00000000-0000-4000-8000-000000000001',
   '50000000-0000-4000-8000-000000000001',
   '{"line1":"12, Gandhi Road","pincode":"572130"}'::jsonb,
   'out_for_delivery', 'cod', 'pending', 10800, 2500, 0, 13300,
   now(), null, null,
   '66666666-0000-4000-8000-0000000000a2', now()),
  ('93000000-0000-4000-8000-0000000000d3',
   '11111111-1111-1111-1111-111111111111',
   '00000000-0000-4000-8000-000000000001',
   '50000000-0000-4000-8000-000000000001',
   '{"line1":"12, Gandhi Road","pincode":"572130"}'::jsonb,
   'delivered', 'cod', 'paid', 10800, 2500, 0, 13300,
   now() - interval '2 hours', now() - interval '1 hour', null,
   '66666666-0000-4000-8000-0000000000a3', now() - interval '2 hours'),
  ('93000000-0000-4000-8000-0000000000d4',
   '11111111-1111-1111-1111-111111111111',
   '00000000-0000-4000-8000-000000000001',
   '50000000-0000-4000-8000-000000000001',
   '{"line1":"12, Gandhi Road","pincode":"572130"}'::jsonb,
   'delivered', 'cod', 'paid', 10800, 2500, 0, 13300,
   now() - interval '26 hours', now() - interval '25 hours', null,
   '66666666-0000-4000-8000-0000000000a4', now() - interval '26 hours'),
  ('93000000-0000-4000-8000-0000000000d5',
   '11111111-1111-1111-1111-111111111111',
   '00000000-0000-4000-8000-000000000001',
   '50000000-0000-4000-8000-000000000001',
   '{"line1":"12, Gandhi Road","pincode":"572130"}'::jsonb,
   'cancelled', 'cod', 'pending', 10800, 2500, 0, 13300,
   now() - interval '3 hours', null, null,
   '66666666-0000-4000-8000-0000000000a5', now() - interval '3 hours'),
  ('93000000-0000-4000-8000-0000000000d6',
   '11111111-1111-1111-1111-111111111111',
   '00000000-0000-4000-8000-000000000001',
   '50000000-0000-4000-8000-000000000001',
   '{"line1":"12, Gandhi Road","pincode":"572130"}'::jsonb,
   'failed', 'cod', 'pending', 10800, 2500, 0, 13300,
   now() - interval '4 hours', null, 'other',
   '66666666-0000-4000-8000-0000000000a6', now() - interval '4 hours'),
  ('93000000-0000-4000-8000-0000000000d7',
   '11111111-1111-1111-1111-111111111111',
   '00000000-0000-4000-8000-000000000001',
   '50000000-0000-4000-8000-000000000001',
   '{"line1":"12, Gandhi Road","pincode":"572130"}'::jsonb,
   'delivered', 'cod', 'paid', 10800, 2500, 0, 13300,
   now() - interval '25 hours', now() - interval '24 hours', null,
   '66666666-0000-4000-8000-0000000000a7', now() - interval '25 hours');

-- -----------------------------------------------------------------------------
-- 3. The customer's phone view, while the errand is live.
-- -----------------------------------------------------------------------------
reset role;
set role authenticated;
select test_result.sign_in('11111111-1111-1111-1111-111111111111');   -- Asha

select test_result.eq(
  'the rider on her order in progress is visible',
  (select count(*) from public.rider_directory
    where id = '66666666-0000-4000-8000-0000000000a1'),
  1
);
select test_result.eq(
  'the rider on her out-for-delivery order is visible',
  (select count(*) from public.rider_directory
    where id = '66666666-0000-4000-8000-0000000000a2'),
  1
);
select test_result.eq(
  'the rider who delivered ONE hour ago is still visible',
  (select count(*) from public.rider_directory
    where id = '66666666-0000-4000-8000-0000000000a3'),
  1
);

select test_result.eq(
  'the rider who delivered TWENTY-FIVE hours ago is gone',
  (select count(*) from public.rider_directory
    where id = '66666666-0000-4000-8000-0000000000a4'),
  0
);
select test_result.eq(
  'the rider on her cancelled order is gone â€” the shop is the contact',
  (select count(*) from public.rider_directory
    where id = '66666666-0000-4000-8000-0000000000a5'),
  0
);
select test_result.eq(
  'the rider on her failed order is gone too',
  (select count(*) from public.rider_directory
    where id = '66666666-0000-4000-8000-0000000000a6'),
  0
);
select test_result.eq(
  'the boundary is sharp: delivered EXACTLY 24 hours ago is already outside',
  (select count(*) from public.rider_directory
    where id = '66666666-0000-4000-8000-0000000000a7'),
  0
);

-- -----------------------------------------------------------------------------
-- 4. The owner's work view does not narrow.
-- -----------------------------------------------------------------------------
select test_result.sign_out();
select test_result.sign_in('33333333-3333-3333-3333-333333333333');   -- Owner

select test_result.eq(
  'the owner reads every assigned rider, whatever the order''s state',
  (select count(*) from public.rider_directory
    where id::text like '66666666-0000-4000-8000-0000000000a%'),
  7
);

-- -----------------------------------------------------------------------------
-- 5. Put the fixtures back.
-- -----------------------------------------------------------------------------
reset role;

delete from public.orders
  where id::text like '93000000-%';

delete from public.profiles
  where id::text like '66666666-0000-4000-8000-0000000000a%';
delete from auth.users
  where id::text like '66666666-0000-4000-8000-0000000000a%';

select test_result.eq(
  'fixture restored: no window riders remain',
  (select count(*) from public.profiles
    where id::text like '66666666-0000-4000-8000-0000000000a%'),
  0
);
