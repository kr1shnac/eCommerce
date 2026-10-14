-- =============================================================================
-- 09 · Rider assignment: claiming orders, and staying out of other riders' work.
--
-- Rule 9.7: a new policy or guard is not done until a test proves the forbidden
-- case fails. The two claims this file has to make true are:
--
--   1. a rider CAN claim an unassigned order and drive it to delivered;
--   2. a rider CANNOT touch an order that belongs to somebody else, cannot
--      reassign, cannot cancel, cannot change money, and cannot move a status
--      backwards.
--
-- as = assignment state column, so this file does not need the whole app.
-- =============================================================================

select test_result.begin_suite('09 rider assignment');

-- -----------------------------------------------------------------------------
-- Setup, as the table owner (not signed in). Setting up is not what is tested.
-- A SECOND rider is needed: "cannot touch another rider's order" means nothing
-- with only one rider in the shop.
-- -----------------------------------------------------------------------------

reset role;

insert into auth.users (id, phone, raw_user_meta_data) values
  ('55555555-5555-5555-5555-555555555555', '+919800000005', '{"full_name":"Rider Two"}')
on conflict (id) do nothing;

update public.profiles
set role = 'delivery' where id = '55555555-5555-5555-5555-555555555555';

-- Two fresh, unassigned orders placed by Asha. Fixed ids so assertions can name
-- them. Inserting as the owner still fires orders_guard_insert, which sees no
-- signed-in user and treats the writer as a customer: the values below are the
-- ones it would force anyway.
insert into public.orders (
  id, user_id, store_id, address_id, delivery_address,
  status, payment_method, payment_status,
  subtotal_paise, delivery_fee_paise, discount_paise, total_paise
)
values
  ('70000000-0000-4000-8000-000000000001',
   '11111111-1111-1111-1111-111111111111',
   '00000000-0000-4000-8000-000000000001',
   '50000000-0000-4000-8000-000000000001',
   '{"line1":"12, Gandhi Road","pincode":"572130"}'::jsonb,
   'placed', 'cod', 'pending', 5000, 0, 0, 5000),
  ('70000000-0000-4000-8000-000000000002',
   '11111111-1111-1111-1111-111111111111',
   '00000000-0000-4000-8000-000000000001',
   '50000000-0000-4000-8000-000000000001',
   '{"line1":"12, Gandhi Road","pincode":"572130"}'::jsonb,
   'placed', 'cod', 'pending', 6000, 0, 0, 6000)
on conflict (id) do nothing;

select test_result.eq(
  'the new order is really unassigned',
  (select (assigned_to is null)::text from public.orders
    where id = '70000000-0000-4000-8000-000000000001'),
  'true'
);

select test_result.eq(
  'the second rider really is delivery staff',
  (select role::text from public.profiles where id = '55555555-5555-5555-5555-555555555555'),
  'delivery'
);

-- =============================================================================
-- The owner assigns riders (admin path is unchanged and must keep working).
-- =============================================================================

set role authenticated;
select test_result.sign_in('33333333-3333-3333-3333-333333333333');

select test_result.touches(
  'the shop owner can assign a rider to an order',
  $$
  update public.orders
     set assigned_to = '44444444-4444-4444-4444-444444444444'
   where id = '70000000-0000-4000-8000-000000000001'
  $$,
  1
);

select test_result.eq(
  'the assignment really landed, and the clock was filled in',
  (select (assigned_to = '44444444-4444-4444-4444-444444444444'
           and assigned_at is not null)::text
     from public.orders where id = '70000000-0000-4000-8000-000000000001'),
  'true'
);

-- =============================================================================
-- A rider must not touch another rider's order.
-- Rider Two (5555) versus an order assigned to Rider One (4444).
-- =============================================================================

set role authenticated;
select test_result.sign_in('55555555-5555-5555-5555-555555555555');

select test_result.refused(
  'a rider cannot advance an order assigned to somebody else',
  $$
  update public.orders set status = 'confirmed'
   where id = '70000000-0000-4000-8000-000000000001'
  $$,
  '42501'
);

select test_result.refused(
  'a rider cannot steal an order assigned to somebody else',
  $$
  update public.orders set assigned_to = auth.uid()
   where id = '70000000-0000-4000-8000-000000000001'
  $$,
   '42501'
);

select test_result.refused(
  'a rider cannot unassign somebody else''s order',
  $$
  update public.orders set assigned_to = null, assigned_at = null
   where id = '70000000-0000-4000-8000-000000000001'
  $$,
  '42501'
);

-- =============================================================================
-- The rider who owns the order can drive it forward, but only forward.
-- =============================================================================

set role authenticated;
select test_result.sign_in('44444444-4444-4444-4444-444444444444');

select test_result.touches(
  'the assigned rider can confirm the order',
  $$
  update public.orders set status = 'confirmed'
   where id = '70000000-0000-4000-8000-000000000001'
  $$,
  1
);

select test_result.refused(
  'a rider cannot move a status backwards',
  $$
  update public.orders set status = 'placed'
   where id = '70000000-0000-4000-8000-000000000001'
  $$,
  '42501'
);

select test_result.refused(
  'a rider cannot cancel an order',
  $$
  update public.orders set status = 'cancelled'
   where id = '70000000-0000-4000-8000-000000000001'
  $$,
  '42501'
);

select test_result.refused(
  'a rider cannot change what the customer pays',
  $$
  update public.orders set total_paise = 1
   where id = '70000000-0000-4000-8000-000000000001'
  $$,
  '42501'
);

select test_result.refused(
  'a rider cannot change the delivery note',
  $$
  update public.orders set notes = 'leave at door'
   where id = '70000000-0000-4000-8000-000000000001'
  $$,
  '42501'
);

select test_result.refused(
  'a rider cannot change who pays (payment method)',
  $$
  update public.orders set payment_method = 'online'
   where id = '70000000-0000-4000-8000-000000000001'
  $$,
  '42501'
);

select test_result.refused(
  'a rider cannot hand the order to another rider',
  $$
  update public.orders set assigned_to = '55555555-5555-5555-5555-555555555555'
   where id = '70000000-0000-4000-8000-000000000001'
  $$,
  '42501'
);

select test_result.touches(
  'the rider can move it to packing',
  $$
  update public.orders set status = 'packing'
   where id = '70000000-0000-4000-8000-000000000001'
  $$,
  1
);

select test_result.touches(
  'and then out for delivery',
  $$
  update public.orders set status = 'out_for_delivery'
   where id = '70000000-0000-4000-8000-000000000001'
  $$,
  1
);

select test_result.refused(
  'a rider cannot mark delivered without recording the time',
  $$
  update public.orders set status = 'delivered'
   where id = '70000000-0000-4000-8000-000000000001'
  $$,
  '42501'
);

select test_result.touches(
  'the rider can mark it delivered with the time',
  $$
  update public.orders
     set status = 'delivered', delivered_at = now()
   where id = '70000000-0000-4000-8000-000000000001'
  $$,
  1
);

select test_result.refused(
  'and cannot reopen it afterwards',
  $$
  update public.orders set status = 'packing'
   where id = '70000000-0000-4000-8000-000000000001'
  $$,
  '42501'
);

-- =============================================================================
-- Claiming: the second rider takes the unassigned order.
-- =============================================================================

set role authenticated;
select test_result.sign_in('55555555-5555-5555-5555-555555555555');

select test_result.touches(
  'a rider can claim an unassigned order',
  $$
  update public.orders
     set assigned_to = auth.uid(), status = 'confirmed'
   where id = '70000000-0000-4000-8000-000000000002'
     and assigned_to is null
  $$,
  1
);

select test_result.eq(
  'the claim really recorded the second rider',
  (select (assigned_to = '55555555-5555-5555-5555-555555555555')::text
     from public.orders where id = '70000000-0000-4000-8000-000000000002'),
  'true'
);

select test_result.refused(
  'a rider cannot set a delivery time before delivering',
  $$
  update public.orders set delivered_at = now()
   where id = '70000000-0000-4000-8000-000000000002'
  $$,
  '42501'
);

select test_result.sign_in('44444444-4444-4444-4444-444444444444');

select test_result.refused(
  'a rider cannot claim an order somebody else already has',
  $$
  update public.orders set assigned_to = auth.uid()
   where id = '70000000-0000-4000-8000-000000000002'
  $$,
  '42501'
);

-- =============================================================================
-- A customer cannot assign themselves a rider, or move their own status, with a
-- raw UPDATE. (RLS hides the row from a non-staff caller, so 0 rows change.)
-- =============================================================================

set role authenticated;
select test_result.sign_in('11111111-1111-1111-1111-111111111111');

select test_result.touches(
  'a customer cannot assign a rider to their order (0 rows touched)',
  $$
  update public.orders set assigned_to = '44444444-4444-4444-4444-444444444444'
   where id = '70000000-0000-4000-8000-000000000002'
  $$,
  0
);

select test_result.touches(
  'a customer cannot advance their own order by hand (0 rows touched)',
  $$
  update public.orders set status = 'delivered', delivered_at = now()
   where id = '70000000-0000-4000-8000-000000000002'
  $$,
  0
);

-- =============================================================================
-- The owner can reassign and unassign.
-- =============================================================================

set role authenticated;
select test_result.sign_in('33333333-3333-3333-3333-333333333333');

select test_result.touches(
  'the shop owner can reassign an order to another rider',
  $$
  update public.orders
     set assigned_to = '44444444-4444-4444-4444-444444444444'
   where id = '70000000-0000-4000-8000-000000000002'
  $$,
  1
);

select test_result.touches(
  'the shop owner can take an order off a rider',
  $$
  update public.orders
     set assigned_to = null
   where id = '70000000-0000-4000-8000-000000000002'
  $$,
  1
);

select test_result.eq(
  'unassigning cleared the time too (the pair stays consistent)',
  (select (assigned_to is null and assigned_at is null)::text
     from public.orders where id = '70000000-0000-4000-8000-000000000002'),
  'true'
);

-- =============================================================================
-- Reading: staff see every order, and the owner can list the riders.
-- =============================================================================

set role authenticated;
select test_result.sign_in('55555555-5555-5555-5555-555555555555');

select test_result.eq(
  'a rider can read every order (staff see the whole board)',
  (select count(*) from public.orders
    where id in ('70000000-0000-4000-8000-000000000001',
                 '70000000-0000-4000-8000-000000000002')),
  2
);

select test_result.sign_in('33333333-3333-3333-3333-333333333333');

select test_result.ok(
  'the owner can list the riders (at least the two fixtures)',
  (select count(*) from public.profiles where role = 'delivery') >= 2
);

-- =============================================================================
-- Nothing failed silently. Re-read as the owner.
-- =============================================================================

reset role;

select test_result.eq(
  'the first order is delivered by rider one',
  (select (status = 'delivered'
           and assigned_to = '44444444-4444-4444-4444-444444444444'
           and total_paise = 5000
           and notes is null)::text
     from public.orders where id = '70000000-0000-4000-8000-000000000001'),
  'true'
);

select test_result.eq(
  'the second order is nobody''s again and was confirmed, never cancelled',
  (select (assigned_to is null and assigned_at is null
           and status = 'confirmed'
           and total_paise = 6000)::text
     from public.orders where id = '70000000-0000-4000-8000-000000000002'),
  'true'
);
