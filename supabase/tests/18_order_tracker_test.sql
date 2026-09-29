-- =============================================================================
-- 18 · The order tracker: honest failed states, and the rider directory.
--
-- Rule 9.7: a new policy, view or guard is not done until a test proves the
-- forbidden case fails. The claims this file has to make true are:
--
--   1. a rider CAN close an order as failed, and then as returned;
--   2. a failed/returned order MUST carry a reason, and a live order must NOT;
--   3. the happy path still cannot skip a step, go backwards, or be reopened
--      once failed — the honest states are terminal, not a soft cancel;
--   4. a rider still cannot touch money, identity or another rider's order;
--   5. a customer CAN read the assigned rider's name and photo (the view), and
--      CANNOT read any other customer's profile row through it.
--
-- A NOTE ON SETTING UP, because it cost an hour to learn the first time:
-- `orders_guard_insert` forces `status := 'placed'` whenever
-- `current_user_role()` is `customer` — and `current_user_role()` FALLS BACK to
-- `customer` whenever `auth.uid()` is null. So inserting a fixture order as the
-- table owner (no signed-in user) silently rewrites its status, exactly as if a
-- customer had sent a forged one. Every fixture that needs an order past
-- `placed` must therefore be inserted while signed in as the ADMIN, whose branch
-- of the guard rewrites nothing.
-- =============================================================================

select test_result.begin_suite('18 order tracker');

-- -----------------------------------------------------------------------------
-- Setup. Signed in as the shop owner, so the guard leaves the fixture as written.
-- A fresh rider and a pair of orders, so this suite cannot be affected by what
-- test 09 left behind.
-- -----------------------------------------------------------------------------

reset role;

insert into auth.users (id, phone, raw_user_meta_data) values
  ('88888888-8888-8888-8888-888888888888', '+919800000008', '{"full_name":"Rider Three"}')
on conflict (id) do nothing;

update public.profiles
set role = 'delivery',
    avatar_url = 'https://example.invalid/riders/three.jpg'
where id = '88888888-8888-8888-8888-888888888888';

-- As the owner. See the header note.
set role authenticated;
select test_result.sign_in('33333333-3333-3333-3333-333333333333');

insert into public.orders (
  id, user_id, store_id, address_id, delivery_address,
  status, payment_method, payment_status,
  subtotal_paise, delivery_fee_paise, discount_paise, total_paise,
  assigned_to, assigned_at
)
values
  ('70000000-0000-4000-8000-0000000000f1',
   '11111111-1111-1111-1111-111111111111',
   '00000000-0000-4000-8000-000000000001',
   '50000000-0000-4000-8000-000000000001',
   '{"line1":"12, Gandhi Road","pincode":"572130"}'::jsonb,
   'out_for_delivery', 'cod', 'pending', 7000, 0, 0, 7000,
   '88888888-8888-8888-8888-888888888888', now()),
  ('70000000-0000-4000-8000-0000000000f2',
   '11111111-1111-1111-1111-111111111111',
   '00000000-0000-4000-8000-000000000001',
   '50000000-0000-4000-8000-000000000001',
   '{"line1":"12, Gandhi Road","pincode":"572130"}'::jsonb,
   'placed', 'cod', 'pending', 8000, 0, 0, 8000,
   null, null)
on conflict (id) do nothing;

select test_result.eq(
  'the fixture order really is out for delivery (the insert was not rewritten)',
  (select status::text from public.orders
    where id = '70000000-0000-4000-8000-0000000000f1'),
  'out_for_delivery'
);

select test_result.eq(
  'the new enum values exist and are distinct from cancelled',
  (select string_agg(enumlabel, ',' order by enumsortorder)
     from pg_enum e join pg_type t on t.oid = e.enumtypid
    where t.typname = 'order_status'
      and enumlabel in ('failed', 'returned')),
  'failed,returned'
);

-- =============================================================================
-- A live order may not carry a failure reason. As the OWNER, so the guard is out
-- of the way and the CHECK constraint is the thing under test.
-- =============================================================================

select test_result.refused(
  'a live order cannot carry a failure reason',
  $$
  update public.orders set failure_reason = 'not_home'
   where id = '70000000-0000-4000-8000-0000000000f1'
  $$,
  '23514'
);

select test_result.refused(
  'a live order cannot carry a failure note either',
  $$
  update public.orders set failure_note = 'left at the gate'
   where id = '70000000-0000-4000-8000-0000000000f1'
  $$,
  '23514'
);

-- =============================================================================
-- The rider closes the order honestly.
-- =============================================================================

set role authenticated;
select test_result.sign_in('88888888-8888-8888-8888-888888888888');

select test_result.refused(
  'a failed order must carry a reason',
  $$
  update public.orders set status = 'failed'
   where id = '70000000-0000-4000-8000-0000000000f1'
  $$,
  '23514'
);

select test_result.refused(
  'a rider cannot record a reason that is not on the list',
  $$
  update public.orders set status = 'failed', failure_reason = 'because'
   where id = '70000000-0000-4000-8000-0000000000f1'
  $$,
  '23514'
);

select test_result.touches(
  'a rider can fail an out-for-delivery order, with a reason',
  $$
  update public.orders
     set status = 'failed',
         failure_reason = 'not_home',
         failure_note = 'Nobody answered, will try again tomorrow'
   where id = '70000000-0000-4000-8000-0000000000f1'
  $$,
  1
);

select test_result.eq(
  'the failure really landed, and delivered_at stayed empty',
  (select (status = 'failed'
           and failure_reason = 'not_home'
           and delivered_at is null)::text
     from public.orders where id = '70000000-0000-4000-8000-0000000000f1'),
  'true'
);

select test_result.refused(
  'a failed order cannot be reopened as delivered',
  $$
  update public.orders set status = 'delivered', delivered_at = now()
   where id = '70000000-0000-4000-8000-0000000000f1'
  $$,
  '42501'
);

select test_result.refused(
  'a failed order cannot be moved back to out for delivery',
  $$
  update public.orders set status = 'out_for_delivery', failure_reason = null,
         failure_note = null
   where id = '70000000-0000-4000-8000-0000000000f1'
  $$,
  '42501'
);

select test_result.touches(
  'a failed order can be returned to the shop',
  $$
  update public.orders set status = 'returned'
   where id = '70000000-0000-4000-8000-0000000000f1'
  $$,
  1
);

select test_result.refused(
  'a returned order is terminal too',
  $$
  update public.orders set status = 'delivered', delivered_at = now()
   where id = '70000000-0000-4000-8000-0000000000f1'
  $$,
  '42501'
);

-- =============================================================================
-- A placed order cannot fail: the bag has not left the shop yet.
-- =============================================================================

select test_result.touches(
  'the rider can claim the unassigned order',
  $$
  update public.orders set assigned_to = auth.uid(), status = 'confirmed'
   where id = '70000000-0000-4000-8000-0000000000f2'
     and assigned_to is null
  $$,
  1
);

select test_result.refused(
  'a rider cannot fail an order that has not left the shop',
  $$
  update public.orders
     set status = 'failed', failure_reason = 'other'
   where id = '70000000-0000-4000-8000-0000000000f2'
  $$,
  '42501'
);

-- =============================================================================
-- The rider cannot touch money, whoever the rider is, in the new states too.
-- =============================================================================

select test_result.refused(
  'a rider cannot change what the customer pays, on the way to a failure',
  $$
  update public.orders
     set status = 'out_for_delivery', total_paise = 1
   where id = '70000000-0000-4000-8000-0000000000f2'
  $$,
  '42501'
);

select test_result.refused(
  'a rider cannot blank the assigned rider to dodge the claim rule',
  $$
  update public.orders
     set assigned_to = null, assigned_at = null
   where id = '70000000-0000-4000-8000-0000000000f2'
  $$,
  '42501'
);

-- =============================================================================
-- The rider directory: a customer sees name and photo, and nobody else's row.
-- =============================================================================

set role authenticated;
select test_result.sign_in('11111111-1111-1111-1111-111111111111');

select test_result.eq(
  'a customer can read the assigned rider''s name through the directory',
  (select full_name from public.rider_directory
    where id = '88888888-8888-8888-8888-888888888888'),
  'Rider Three'
);

select test_result.eq(
  'and the rider''s photo',
  (select avatar_url from public.rider_directory
    where id = '88888888-8888-8888-8888-888888888888'),
  'https://example.invalid/riders/three.jpg'
);

select test_result.eq(
  'the directory exposes exactly four columns — no role, no created_at',
  (select string_agg(column_name, ',' order by ordinal_position)
     from information_schema.columns
    where table_schema = 'public' and table_name = 'rider_directory'),
  'id,full_name,avatar_url,phone'
);

select test_result.eq(
  'the directory holds riders only — a customer is not in it',
  (select count(*)::text from public.rider_directory
    where id = '11111111-1111-1111-1111-111111111111'),
  '0'
);

-- The whole point of a separate view: it does not become a window onto every
-- profile. A customer still cannot read another customer's row directly — RLS
-- filters it out silently, so the row simply is not there.
select test_result.eq(
  'a customer still cannot read another customer''s profile row',
  (select count(*)::text from public.profiles
    where id = '22222222-2222-2222-2222-222222222222'),
  '0'
);

-- =============================================================================
-- Cleanup: this suite added a rider and two orders. Leave the graph as found.
-- =============================================================================

reset role;

delete from public.orders
 where id in ('70000000-0000-4000-8000-0000000000f1',
              '70000000-0000-4000-8000-0000000000f2');

delete from public.profiles where id = '88888888-8888-8888-8888-888888888888';
delete from auth.users where id = '88888888-8888-8888-8888-888888888888';
