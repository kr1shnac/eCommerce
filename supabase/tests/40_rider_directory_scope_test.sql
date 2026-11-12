-- =============================================================================
-- 40 · The rider directory is per-order: the caller's rider, nobody's phone book
--
-- Migrations 20261021000001 and 20261112000008. The view exists so a customer
-- can read the name, photo and phone of the rider carrying THEIR bag. What it
-- accidentally also did was hand every signed-in user the same four columns for
-- every rider on the shop's staff — a definer-side view with a role filter and
-- no caller filter, granted to `authenticated`.
--
-- The claims this file has to make true:
--
--   1. a customer CAN read the assigned rider of their OWN order — name and
--      photo, exactly as before, so the order screen is untouched;
--   2. a customer CANNOT read a rider who is assigned to somebody else's order;
--   3. a customer CANNOT read a rider who has no order at all;
--   4. the same rider IS visible to the customer who does own that order (so 2
--      is not passing because the view is simply dead), and to the owner;
--   5. the four columns and the `authenticated`-only grant are unchanged;
--   6. RLS on `profiles` still holds — the view was never widened into one.
--
-- A NOTE ON SETTING UP, copied from test 18 because it cost an hour to learn:
-- `orders_guard_insert` forces `status := 'placed'` whenever
-- `current_user_role()` is `customer` — and `current_user_role()` FALLS BACK to
-- `customer` whenever `auth.uid()` is null. So every fixture order below is
-- inserted while signed in as the ADMIN, whose branch of the guard rewrites
-- nothing.
-- =============================================================================

select test_result.begin_suite('40 rider directory scope');

-- -----------------------------------------------------------------------------
-- Setup. Three riders: one on Asha's order AND Ravi's, one on Ravi's order
-- only, and one with no order at all. That third one is the rider who must be
-- invisible to everybody except the shop.
-- -----------------------------------------------------------------------------

reset role;

insert into auth.users (id, phone, raw_user_meta_data) values
  ('8aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '+91980000000a',
   '{"full_name":"Rider Four"}'),
  ('8bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '+91980000000b',
   '{"full_name":"Rider Five"}'),
  ('8ccccccc-cccc-4ccc-8ccc-cccccccccccc', '+91980000000c',
   '{"full_name":"Rider Six"}')
on conflict (id) do nothing;

update public.profiles
   set role = 'delivery',
       avatar_url = 'https://example.invalid/riders/four.jpg'
 where id = '8aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

update public.profiles
   set role = 'delivery'
 where id in ('8bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
              '8ccccccc-cccc-4ccc-8ccc-cccccccccccc');

-- As the owner, so the guard leaves the statuses exactly as written.
set role authenticated;
select test_result.sign_in('33333333-3333-3333-3333-333333333333');

insert into public.orders (
  id, user_id, store_id, address_id, delivery_address,
  status, payment_method, payment_status,
  subtotal_paise, delivery_fee_paise, discount_paise, total_paise,
  assigned_to, assigned_at
)
values
  -- Asha's order, carried by Rider Four.
  ('7aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
   '11111111-1111-1111-1111-111111111111',
   '00000000-0000-4000-8000-000000000001',
   '50000000-0000-4000-8000-000000000001',
   '{"line1":"12, Gandhi Road","pincode":"572130"}'::jsonb,
   'out_for_delivery', 'cod', 'pending', 7000, 0, 0, 7000,
   '8aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', now()),
  -- Ravi's order, carried by the SAME rider (a repeat customer: one row per
  -- rider, never one row per order).
  ('7aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2',
   '22222222-2222-2222-2222-222222222222',
   '00000000-0000-4000-8000-000000000001',
   '50000000-0000-4000-8000-000000000004',
   '{"line1":"45, Nehru Nagar","pincode":"572130"}'::jsonb,
   'out_for_delivery', 'cod', 'pending', 8000, 0, 0, 8000,
   '8aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', now()),
  -- Ravi's order, carried by a rider Asha has never had anything to do with.
  ('7ccccccc-cccc-4ccc-8ccc-cccccccccccc',
   '22222222-2222-2222-2222-222222222222',
   '00000000-0000-4000-8000-000000000001',
   '50000000-0000-4000-8000-000000000004',
   '{"line1":"45, Nehru Nagar","pincode":"572130"}'::jsonb,
   'out_for_delivery', 'cod', 'pending', 9000, 0, 0, 9000,
   '8ccccccc-cccc-4ccc-8ccc-cccccccccccc', now())
on conflict (id) do nothing;

select test_result.eq(
  'the fixture order really is out for delivery (the insert was not rewritten)',
  (select status::text from public.orders
    where id = '7aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'),
  'out_for_delivery'
);

-- =============================================================================
-- 1. The happy path, unchanged: Asha's rider is still readable.
-- =============================================================================

set role authenticated;
select test_result.sign_in('11111111-1111-1111-1111-111111111111');

select test_result.eq(
  'a customer can still read the assigned rider''s name through the directory',
  (select full_name from public.rider_directory
    where id = '8aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  'Rider Four'
);

select test_result.eq(
  'and the rider''s photo',
  (select avatar_url from public.rider_directory
    where id = '8aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  'https://example.invalid/riders/four.jpg'
);

-- =============================================================================
-- 2. The leak it had: a rider who is not on any of MY orders.
--
-- Rider Six is carrying Ravi's bag. Asha has no relationship with him, and
-- before migration 20261112000008 she could read his name, his photo and his
-- phone number anyway.
-- =============================================================================

select test_result.eq(
  'a customer CANNOT read a rider who is assigned to somebody else''s order',
  (select count(*)::text from public.rider_directory
    where id = '8ccccccc-cccc-4ccc-8ccc-cccccccccccc'),
  '0'
);

select test_result.eq(
  'a customer CANNOT read a rider who has no order at all',
  (select count(*)::text from public.rider_directory
    where id = '8bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'),
  '0'
);

-- Scoped to the three riders this suite created, because other suites leave
-- their own assigned riders behind (test 24 never deletes its last order) and a
-- whole-table count would be a test of tidiness rather than of this rule.
-- Rider Five has no order, Rider Six has Ravi's: so Asha sees exactly one.
select test_result.eq(
  'of this suite''s riders, Asha sees exactly the one carrying her bag',
  (select count(*)::text from public.rider_directory
    where id in ('8aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
                 '8bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
                 '8ccccccc-cccc-4ccc-8ccc-cccccccccccc')),
  '1'
);

-- =============================================================================
-- 3. Positive control: the view is alive for the people it is for.
--
-- If the scope above were passing because the view had gone dead, these two
-- would fail too.
-- =============================================================================

set role authenticated;
select test_result.sign_in('22222222-2222-2222-2222-222222222222');

select test_result.eq(
  'Ravi CAN read Rider Six — that rider is carrying Ravi''s bag',
  (select full_name from public.rider_directory
    where id = '8ccccccc-cccc-4ccc-8ccc-cccccccccccc'),
  'Rider Six'
);

select test_result.eq(
  'Ravi sees the rider on his orders exactly once, not once per order',
  (select count(*)::text from public.rider_directory
    where id = '8aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  '1'
);

set role authenticated;
select test_result.sign_in('33333333-3333-3333-3333-333333333333');

select test_result.eq(
  'the owner can still read any assigned rider for the owner''s board',
  (select string_agg(full_name, ',' order by full_name)
     from public.rider_directory
    where id in ('8aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
                 '8bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
                 '8ccccccc-cccc-4ccc-8ccc-cccccccccccc')),
  'Rider Four,Rider Six'
);

-- =============================================================================
-- 4. What did not change: four columns, no anonymous read, profiles still RLS.
-- =============================================================================

select test_result.eq(
  'the directory still exposes exactly four columns — no role, no created_at',
  (select string_agg(column_name, ',' order by ordinal_position)
     from information_schema.columns
    where table_schema = 'public' and table_name = 'rider_directory'),
  'id,full_name,avatar_url,phone'
);

set role anon;
select test_result.sign_out();

select test_result.refused(
  'a signed-out visitor still cannot read the directory at all',
  $$ select count(*)::text from public.rider_directory $$,
  '42501'
);

-- Back to a customer, because the next check is about RLS on `profiles`, and
-- `sign_in` alone does not change the role.
set role authenticated;
select test_result.sign_in('11111111-1111-1111-1111-111111111111');

select test_result.eq(
  'a customer still cannot read another customer''s profile row',
  (select count(*)::text from public.profiles
    where id = '22222222-2222-2222-2222-222222222222'),
  '0'
);

-- =============================================================================
-- Cleanup: this suite added three riders and three orders. Leave the graph as
-- found — the nightly re-run inserts with `on conflict do nothing`.
-- =============================================================================

reset role;

delete from public.orders
 where id in ('7aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
              '7aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2',
              '7ccccccc-cccc-4ccc-8ccc-cccccccccccc');

delete from public.profiles
 where id in ('8aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
              '8bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
              '8ccccccc-cccc-4ccc-8ccc-cccccccccccc');

delete from auth.users
 where id in ('8aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
              '8bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
              '8ccccccc-cccc-4ccc-8ccc-cccccccccccc');
