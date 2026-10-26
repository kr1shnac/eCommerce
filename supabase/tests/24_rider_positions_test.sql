-- =============================================================================
-- 24 · Rider position: who may write one, who may read one, and what happens
--      when the delivery ends.
--
-- Rule 9.7: a table, a view and a security-definer function are not done until a
-- test proves the FORBIDDEN case fails. The claims this file has to make true:
--
--   1. a rider CAN record their own position, but ONLY while carrying an order;
--   2. nobody can write a position into the table directly — not a customer, not
--      a rider, not an admin pretending to be one — so the function cannot be
--      bypassed from the app;
--   3. the function takes no rider id, so there is no parameter to point at
--      somebody else;
--   4. a customer CAN read the position for their OWN out-for-delivery order,
--      and CANNOT read another customer's, a delivered order's, a stale fix, or
--      a fix too imprecise to be a place;
--   5. a delivery partner canNOT read positions through the view at all;
--   6. `picked_up_at` is set once, by the assigned rider, only when the bag can
--      exist, and can never be cleared or back-dated from the future;
--   7. when the delivery ends the position is DELETED, and deleting the rider's
--      account deletes it too (cascade).
--
-- The privacy claim is the important one. "A rider is tracked only while
-- carrying an order" is a promise made to an employee on a consent screen. If a
-- refactor ever breaks it, this file is the only thing that would notice.
-- =============================================================================

select test_result.begin_suite('rider positions');

-- -----------------------------------------------------------------------------
-- Clear the slate.
--
-- Earlier test files leave orders in `out_for_delivery` assigned to these two
-- riders. That matters twice over: "a rider with no active delivery" would be a
-- lie, and `record_my_position()` picks the most recently assigned live order,
-- so the position could land on somebody else's fixture. Unassigning first makes
-- both statements true. This is an admin action, so the admin is signed in even
-- though the statement runs as the table owner (the guards read auth.uid()).
-- -----------------------------------------------------------------------------

select test_result.sign_in('33333333-3333-3333-3333-333333333333');

update public.orders
set assigned_to = null
where status = 'out_for_delivery'
  and assigned_to in ('44444444-4444-4444-4444-444444444444',
                      '55555555-5555-5555-5555-555555555555');

select test_result.sign_out();

-- -----------------------------------------------------------------------------
-- Setup. Done as the table owner, which is not what is under test.
--
-- A second rider exists so "another rider" is a real person rather than a
-- hypothetical. Test 09 normally creates this user; `on conflict do nothing`
-- makes this file independent of test ordering.
-- -----------------------------------------------------------------------------

insert into auth.users (id, phone, raw_user_meta_data) values
  ('55555555-5555-5555-5555-555555555555', '+919800000005',
   '{"full_name":"Rider Two"}')
on conflict (id) do nothing;

update public.profiles
set role = 'delivery'
where id = '55555555-5555-5555-5555-555555555555';

-- Asha's door gets coordinates so the distance/ETA path is exercised with real
-- numbers. Ravi's address is deliberately left without them: the view must then
-- return NULL rather than invent an ETA.
update public.addresses
set lat = 13.0316, lng = 77.0395
where id = '50000000-0000-4000-8000-000000000001';

update public.addresses
set lat = null, lng = null
where id = '50000000-0000-4000-8000-000000000004';

-- Three orders. Inserting as the owner still fires orders_guard_insert, which
-- sees nobody signed in and treats the writer as a customer, so it forces
-- status 'placed'; the admin releases them below. (Learned the hard way in
-- test 18.)
insert into public.orders (
  id, user_id, store_id, address_id, delivery_address,
  status, payment_method, payment_status,
  subtotal_paise, delivery_fee_paise, discount_paise, total_paise
)
values
  ('80000000-0000-4000-8000-000000000001',
   '11111111-1111-1111-1111-111111111111',
   '00000000-0000-4000-8000-000000000001',
   '50000000-0000-4000-8000-000000000001',
   '{"line1":"12, Gandhi Road","pincode":"572130"}'::jsonb,
   'placed', 'cod', 'pending', 5000, 0, 0, 5000),
  ('80000000-0000-4000-8000-000000000002',
   '22222222-2222-2222-2222-222222222222',
   '00000000-0000-4000-8000-000000000001',
   '50000000-0000-4000-8000-000000000004',
   '{"line1":"45, Nehru Nagar","pincode":"572130"}'::jsonb,
   'placed', 'cod', 'pending', 6000, 0, 0, 6000),
  ('80000000-0000-4000-8000-000000000003',
   '11111111-1111-1111-1111-111111111111',
   '00000000-0000-4000-8000-000000000001',
   '50000000-0000-4000-8000-000000000001',
   '{"line1":"12, Gandhi Road","pincode":"572130"}'::jsonb,
   'placed', 'cod', 'pending', 7000, 0, 0, 7000)
on conflict (id) do nothing;

-- =============================================================================
-- 1. The arithmetic, before anything depends on it.
-- =============================================================================

select test_result.eq(
  'a point is zero metres from itself',
  public.metres_between(13.0226, 77.0295, 13.0226, 77.0295)::text,
  '0'
);

select test_result.eq(
  '0.001 degrees north is ~111 m (matches src/lib/tracking-rules.ts)',
  round(public.metres_between(13.0226, 77.0295, 13.0236, 77.0295)::numeric, 1)::text,
  '111.2'
);

select test_result.eq(
  '0.001 degrees east is ~108 m at Kunigal latitude',
  round(public.metres_between(13.0226, 77.0295, 13.0226, 77.0305)::numeric, 1)::text,
  '108.3'
);

select test_result.eq(
  'distance is symmetric',
  round(public.metres_between(13.0226, 77.0295, 13.0316, 77.0395)::numeric, 1)::text,
  round(public.metres_between(13.0316, 77.0395, 13.0226, 77.0295)::numeric, 1)::text
);

select test_result.eq('1000 m is a 4 minute ETA', public.eta_minutes_for(1000)::text, '4');
select test_result.eq('zero distance is floored at 3 minutes', public.eta_minutes_for(0)::text, '3');
select test_result.eq('500 m is floored at 3 minutes, not "2 min"', public.eta_minutes_for(500)::text, '3');
select test_result.ok(
  'beyond 45 minutes there is no ETA at all, rather than a made-up one',
  public.eta_minutes_for(15000) is null
);
select test_result.ok(
  'a negative distance has no ETA',
  public.eta_minutes_for(-1) is null
);

-- =============================================================================
-- 2. Nobody writes a position except a delivery partner carrying an order.
--    Order 1 is still 'placed' at this point, so even the rider has no delivery.
-- =============================================================================

set role authenticated;

select test_result.sign_in('44444444-4444-4444-4444-444444444444');
select test_result.refused(
  'a rider with no out-for-delivery order cannot record a position',
  $$select public.record_my_position(13.0230, 77.0300, 12)$$,
  '42501'
);

select test_result.sign_in('11111111-1111-1111-1111-111111111111');
select test_result.refused(
  'a customer cannot record a rider position',
  $$select public.record_my_position(13.0230, 77.0300, 12)$$,
  '42501'
);

select test_result.sign_in('33333333-3333-3333-3333-333333333333');
select test_result.refused(
  'the shop owner is not a delivery partner and cannot record a position',
  $$select public.record_my_position(13.0230, 77.0300, 12)$$,
  '42501'
);

select test_result.sign_out();
select test_result.refused(
  'a signed-out caller cannot record a position',
  $$select public.record_my_position(13.0230, 77.0300, 12)$$,
  '42501'
);

-- The bypass this table must not allow: writing straight to the table, which
-- would let a rider record a position while idle, or point it at another rider.
select test_result.sign_in('44444444-4444-4444-4444-444444444444');
select test_result.refused(
  'a rider cannot INSERT into rider_positions directly',
  $$
  insert into public.rider_positions (rider_id, order_id, lat, lng)
  values ('44444444-4444-4444-4444-444444444444',
          '80000000-0000-4000-8000-000000000001', 13.02, 77.02)
  $$,
  '42501'
);

select test_result.sign_in('11111111-1111-1111-1111-111111111111');
select test_result.refused(
  'a customer cannot SELECT from rider_positions directly',
  $$select count(*) from public.rider_positions$$,
  '42501'
);

-- =============================================================================
-- 3. The owner releases order 1 and its rider records a position.
-- =============================================================================

reset role;
-- The guards read auth.uid(), not the SQL role, so "the owner does this" means
-- signing in as the admin profile before the update — even while running as the
-- table owner. (This is the trap test 18 documents.)
select test_result.sign_in('33333333-3333-3333-3333-333333333333');

select test_result.touches(
  'the owner puts rider one on order 1 and releases it',
  $$
  update public.orders
     set assigned_to = '44444444-4444-4444-4444-444444444444',
         status = 'out_for_delivery'
   where id = '80000000-0000-4000-8000-000000000001'
  $$,
  1
);

set role authenticated;
select test_result.sign_in('44444444-4444-4444-4444-444444444444');

select public.record_my_position(13.0230, 77.0300, 12);

reset role;

select test_result.eq(
  'the rider''s position is stored against the order they are carrying',
  (select order_id::text from public.rider_positions
    where rider_id = '44444444-4444-4444-4444-444444444444'),
  '80000000-0000-4000-8000-000000000001'
);

select test_result.eq(
  'the fix landed at the coordinates the phone reported',
  (select lat::text || ',' || lng::text from public.rider_positions
    where rider_id = '44444444-4444-4444-4444-444444444444'),
  '13.023,77.03'
);

set role authenticated;
select test_result.sign_in('44444444-4444-4444-4444-444444444444');
select public.record_my_position(13.0240, 77.0310, 9);
reset role;

select test_result.eq(
  'one row per rider: a second fix overwrites, it does not append',
  (select count(*) from public.rider_positions
    where rider_id = '44444444-4444-4444-4444-444444444444')::text,
  '1'
);

select test_result.eq(
  'the overwrite is the newer position',
  (select lat::text from public.rider_positions
    where rider_id = '44444444-4444-4444-4444-444444444444'),
  '13.024'
);

-- =============================================================================
-- 4. A fix that is not a place is refused.
-- =============================================================================

set role authenticated;
select test_result.sign_in('44444444-4444-4444-4444-444444444444');

select test_result.refused(
  '0,0 is refused — it is what a failed lookup returns',
  $$select public.record_my_position(0, 0, 10)$$,
  '22023'
);
select test_result.refused(
  'a latitude beyond 90 is refused',
  $$select public.record_my_position(91, 77.03, 10)$$,
  '22023'
);
select test_result.refused(
  'a null latitude is refused',
  $$select public.record_my_position(null, 77.03, 10)$$,
  '22023'
);
select test_result.refused(
  'a negative accuracy is refused',
  $$select public.record_my_position(13.024, 77.031, -5)$$,
  '22023'
);

reset role;

select test_result.eq(
  'none of the refused fixes replaced the good one',
  (select lat::text from public.rider_positions
    where rider_id = '44444444-4444-4444-4444-444444444444'),
  '13.024'
);

-- =============================================================================
-- 5. The customer reads their own rider's position — and only that.
-- =============================================================================

set role authenticated;
select test_result.sign_in('11111111-1111-1111-1111-111111111111');

select test_result.eq(
  'Asha sees exactly one position, for her own order',
  (select count(*) from public.order_rider_position)::text,
  '1'
);

select test_result.eq(
  'the position is the rider''s latest fix',
  (select lat::text || ',' || lng::text
     from public.order_rider_position
    where order_id = '80000000-0000-4000-8000-000000000001'),
  '13.024,77.031'
);

select test_result.ok(
  'the age is computed on the server and is a believable number of seconds',
  (select age_seconds between 0 and 60
     from public.order_rider_position
    where order_id = '80000000-0000-4000-8000-000000000001')
);

select test_result.ok(
  'the view distances the rider from the door using the server formula',
  (select abs(distance_m
              - public.metres_between(13.024, 77.031, 13.0316, 77.0395)) < 0.15
     from public.order_rider_position
    where order_id = '80000000-0000-4000-8000-000000000001')
);

select test_result.ok(
  'the ETA is derived from that distance, not sent by the app',
  (select eta_minutes = public.eta_minutes_for(distance_m)
     from public.order_rider_position
    where order_id = '80000000-0000-4000-8000-000000000001')
);

-- =============================================================================
-- 6. A second customer's delivery is invisible to the first.
-- =============================================================================

reset role;
select test_result.sign_in('33333333-3333-3333-3333-333333333333');
select test_result.touches(
  'the owner puts rider two on order 2 and releases it',
  $$
  update public.orders
     set assigned_to = '55555555-5555-5555-5555-555555555555',
         status = 'out_for_delivery'
   where id = '80000000-0000-4000-8000-000000000002'
  $$,
  1
);

set role authenticated;
select test_result.sign_in('55555555-5555-5555-5555-555555555555');
select public.record_my_position(13.0100, 77.0200, 20);
reset role;

set role authenticated;
select test_result.sign_in('11111111-1111-1111-1111-111111111111');
select test_result.eq(
  'Asha still sees only her own order',
  (select count(*) from public.order_rider_position)::text,
  '1'
);
select test_result.eq(
  'and it is order 1, not Ravi''s',
  (select string_agg(distinct order_id::text, ',')
     from public.order_rider_position),
  '80000000-0000-4000-8000-000000000001'
);

select test_result.sign_in('22222222-2222-2222-2222-222222222222');
select test_result.eq(
  'Ravi sees only his own order',
  (select count(*) from public.order_rider_position)::text,
  '1'
);
select test_result.ok(
  'with no address coordinates there is NO distance and NO invented ETA',
  (select distance_m is null and eta_minutes is null
     from public.order_rider_position
    where order_id = '80000000-0000-4000-8000-000000000002')
);

-- A delivery partner is not a customer and must not read positions at all.
select test_result.sign_in('44444444-4444-4444-4444-444444444444');
select test_result.eq(
  'a rider cannot read positions through the view',
  (select count(*) from public.order_rider_position)::text,
  '0'
);

select test_result.sign_in('33333333-3333-3333-3333-333333333333');
select test_result.eq(
  'the shop owner can see both live deliveries',
  (select count(*) from public.order_rider_position)::text,
  '2'
);

-- =============================================================================
-- 7. A stale fix, and a fix too imprecise to be a place, are not returned.
-- =============================================================================

reset role;
update public.rider_positions
set recorded_at = now() - interval '11 minutes'
where rider_id = '44444444-4444-4444-4444-444444444444';

set role authenticated;
select test_result.sign_in('11111111-1111-1111-1111-111111111111');
select test_result.eq(
  'a fix older than 10 minutes is not returned at all',
  (select count(*) from public.order_rider_position)::text,
  '0'
);

reset role;
update public.rider_positions
set recorded_at = now(),
    accuracy_m = 500
where rider_id = '44444444-4444-4444-4444-444444444444';

set role authenticated;
select test_result.sign_in('11111111-1111-1111-1111-111111111111');
select test_result.eq(
  'a 500 m accuracy circle is not "where he is"',
  (select count(*) from public.order_rider_position)::text,
  '0'
);

reset role;
update public.rider_positions
set accuracy_m = 12
where rider_id = '44444444-4444-4444-4444-444444444444';

set role authenticated;
select test_result.sign_in('11111111-1111-1111-1111-111111111111');
select test_result.eq(
  'a good fix is back after the accuracy improves',
  (select count(*) from public.order_rider_position)::text,
  '1'
);

-- =============================================================================
-- 8. `picked_up_at`: once, by the assigned rider, only when the bag exists.
-- =============================================================================

-- A customer cannot claim the bag was picked up. Two defences stack here and the
-- FIRST one is row-level security: the orders UPDATE policy is staff-only, so a
-- customer's UPDATE matches no row and raises nothing. That is why this is a
-- `touches(..., 0)` rather than a `refused(...)`: RLS has no opinion to express,
-- it simply makes the row invisible. The trigger below is the second defence, for
-- the day a customer-facing column ever becomes writable.
set role authenticated;
select test_result.sign_in('11111111-1111-1111-1111-111111111111');
select test_result.touches(
  'a customer cannot claim the bag was picked up (the row is not theirs to write)',
  $$
  update public.orders set picked_up_at = now()
   where id = '80000000-0000-4000-8000-000000000001'
  $$,
  0
);

select test_result.sign_in('55555555-5555-5555-5555-555555555555');
select test_result.refused(
  'a rider cannot claim somebody else''s bag',
  $$
  update public.orders set picked_up_at = now()
   where id = '80000000-0000-4000-8000-000000000001'
  $$,
  '42501'
);

select test_result.sign_in('44444444-4444-4444-4444-444444444444');
select test_result.refused(
  'a pickup time in the future is refused',
  $$
  update public.orders set picked_up_at = now() + interval '2 hours'
   where id = '80000000-0000-4000-8000-000000000001'
  $$,
  '22023'
);

select test_result.touches(
  'the assigned rider CAN record the pickup',
  $$
  update public.orders set picked_up_at = now()
   where id = '80000000-0000-4000-8000-000000000001'
  $$,
  1
);

select test_result.refused(
  'the pickup cannot be recorded twice',
  $$
  update public.orders set picked_up_at = now()
   where id = '80000000-0000-4000-8000-000000000001'
  $$,
  '42501'
);

select test_result.refused(
  'the pickup cannot be cleared once it is a fact',
  $$
  update public.orders set picked_up_at = null
   where id = '80000000-0000-4000-8000-000000000001'
  $$,
  '42501'
);

-- A delivered order is past the point where a bag can be picked up.
select test_result.sign_in('33333333-3333-3333-3333-333333333333');
reset role;
update public.orders
set assigned_to = '44444444-4444-4444-4444-444444444444',
    status = 'delivered'
where id = '80000000-0000-4000-8000-000000000003';

set role authenticated;
select test_result.sign_in('44444444-4444-4444-4444-444444444444');
select test_result.refused(
  'a bag cannot be picked up from an already-delivered order',
  $$
  update public.orders set picked_up_at = now()
   where id = '80000000-0000-4000-8000-000000000003'
  $$,
  '42501'
);

-- =============================================================================
-- 9. The position does not outlive the delivery.
-- =============================================================================

reset role;
select test_result.sign_in('33333333-3333-3333-3333-333333333333');

select test_result.ok(
  'the position exists before the delivery closes',
  exists (select 1 from public.rider_positions
           where order_id = '80000000-0000-4000-8000-000000000001')
);

update public.orders
set status = 'delivered'
where id = '80000000-0000-4000-8000-000000000001';

select test_result.ok(
  'closing the delivery DELETES the stored position',
  not exists (select 1 from public.rider_positions
               where order_id = '80000000-0000-4000-8000-000000000001')
);

set role authenticated;
select test_result.sign_in('11111111-1111-1111-1111-111111111111');
select test_result.eq(
  'and the customer can no longer see a position for it',
  (select count(*) from public.order_rider_position)::text,
  '0'
);

-- =============================================================================
-- 10. Deleting the rider's account deletes their position (cascade).
-- =============================================================================

reset role;
select test_result.sign_in('33333333-3333-3333-3333-333333333333');

insert into auth.users (id, phone, raw_user_meta_data)
values ('66666666-6666-6666-6666-666666666666', '+919800000006',
        '{"full_name":"Rider Three"}')
on conflict (id) do nothing;

update public.profiles
set role = 'delivery'
where id = '66666666-6666-6666-6666-666666666666';

insert into public.orders (
  id, user_id, store_id, address_id, delivery_address,
  status, payment_method, payment_status,
  subtotal_paise, delivery_fee_paise, discount_paise, total_paise
)
values (
  '80000000-0000-4000-8000-000000000004',
  '11111111-1111-1111-1111-111111111111',
  '00000000-0000-4000-8000-000000000001',
  '50000000-0000-4000-8000-000000000001',
  '{"line1":"12, Gandhi Road","pincode":"572130"}'::jsonb,
  'placed', 'cod', 'pending', 5000, 0, 0, 5000
)
on conflict (id) do nothing;

update public.orders
set assigned_to = '66666666-6666-6666-6666-666666666666',
    status = 'out_for_delivery'
where id = '80000000-0000-4000-8000-000000000004';

set role authenticated;
select test_result.sign_in('66666666-6666-6666-6666-666666666666');
select public.record_my_position(13.0250, 77.0320, 8);
reset role;

select test_result.ok(
  'the third rider''s position is stored',
  exists (select 1 from public.rider_positions
           where rider_id = '66666666-6666-6666-6666-666666666666')
);

-- Deleting the rider's account is an owner action in production, and it must be
-- done as the admin: the cascade sets orders.assigned_to to NULL, which fires
-- orders_guard_update, and a signed-in *rider* would be refused by that guard
-- while their own profile is already gone.
select test_result.sign_in('33333333-3333-3333-3333-333333333333');

delete from auth.users where id = '66666666-6666-6666-6666-666666666666';

select test_result.ok(
  'deleting the rider''s auth user cascades the position away',
  not exists (select 1 from public.rider_positions
               where rider_id = '66666666-6666-6666-6666-666666666666')
);
