-- =============================================================================
-- 25 · order_feedback: one honest answer per delivered order
--
-- Rule 9.7: a new table and a new policy are not done until a test proves the
-- forbidden case fails. The claims this file makes true are:
--
--   1. a customer CAN answer for their own order once it is `delivered`;
--   2. they CANNOT answer before it arrives, for somebody else's order, or
--      twice for the same order;
--   3. "something was wrong" always carries one reason from the fixed list,
--      and "all fine" never carries a reason;
--   4. a customer reads only their own answer; the shop and the rider read all;
--   5. the record is immutable — an UPDATE or DELETE succeeds having changed
--      nothing, for a customer and even for the admin;
--   6. erasing the account takes the feedback with it, while the order (the
--      shop's ledger) survives under the tombstone.
--
-- A NOTE ON SETUP, the same trap as tests 18–20: `orders_guard_insert` forces a
-- customer's order to `placed`, and `current_user_role()` falls back to
-- `customer` when `auth.uid()` is null. Every fixture below that needs a
-- status past `placed` is therefore inserted while signed in as the ADMIN.
-- =============================================================================

select test_result.begin_suite('25 order feedback');

-- -----------------------------------------------------------------------------
-- Setup, as the shop owner. Four orders:
--   fb01  Asha's, delivered            -> the happy path
--   fb02  Asha's, out_for_delivery     -> too early to answer
--   fb03  Ravi's, delivered            -> not Asha's to answer
--   fb04  Asha's, failed               -> never arrived, so not a feedback case
-- -----------------------------------------------------------------------------

reset role;
set role authenticated;
select test_result.sign_in('33333333-3333-3333-3333-333333333333');

insert into public.orders (
  id, user_id, store_id, address_id, delivery_address,
  status, payment_method, payment_status,
  subtotal_paise, delivery_fee_paise, discount_paise, total_paise,
  delivered_at, failure_reason
)
values
  ('70000000-0000-4000-8000-00000000fb01',
   '11111111-1111-1111-1111-111111111111',
   '00000000-0000-4000-8000-000000000001',
   '50000000-0000-4000-8000-000000000001',
   '{"line1":"12, Gandhi Road","pincode":"572130"}'::jsonb,
   'delivered', 'cod', 'paid', 4500, 0, 0, 4500, now(), null),
  ('70000000-0000-4000-8000-00000000fb02',
   '11111111-1111-1111-1111-111111111111',
   '00000000-0000-4000-8000-000000000001',
   '50000000-0000-4000-8000-000000000001',
   '{"line1":"12, Gandhi Road","pincode":"572130"}'::jsonb,
   'out_for_delivery', 'cod', 'pending', 5000, 0, 0, 5000, null, null),
  ('70000000-0000-4000-8000-00000000fb03',
   '22222222-2222-2222-2222-222222222222',
   '00000000-0000-4000-8000-000000000001',
   '50000000-0000-4000-8000-000000000004',
   '{"line1":"45, Nehru Nagar","pincode":"572130"}'::jsonb,
   'delivered', 'cod', 'paid', 6000, 0, 0, 6000, now(), null),
  ('70000000-0000-4000-8000-00000000fb04',
   '11111111-1111-1111-1111-111111111111',
   '00000000-0000-4000-8000-000000000001',
   '50000000-0000-4000-8000-000000000001',
   '{"line1":"12, Gandhi Road","pincode":"572130"}'::jsonb,
   'failed', 'cod', 'pending', 3500, 0, 0, 3500, null, 'not_home')
on conflict (id) do nothing;

select test_result.eq(
  'the delivered fixture really is delivered (the insert was not rewritten)',
  (select status::text from public.orders
    where id = '70000000-0000-4000-8000-00000000fb01'),
  'delivered'
);

-- =============================================================================
-- Asha answers for her own delivered order.
-- =============================================================================

set role authenticated;
select test_result.sign_in('11111111-1111-1111-1111-111111111111');

select test_result.inserted(
  'a customer can say everything was fine about her own delivered order',
  $$
  insert into public.order_feedback (order_id, user_id, was_ok, reason)
  values ('70000000-0000-4000-8000-00000000fb01',
          '11111111-1111-1111-1111-111111111111', true, null)
  $$
);

select test_result.eq(
  'the answer landed as written',
  (select was_ok::text || ':' || coalesce(reason, 'none')
     from public.order_feedback
    where order_id = '70000000-0000-4000-8000-00000000fb01'),
  'true:none'
);

select test_result.refused(
  'the same order cannot be answered twice',
  $$
  insert into public.order_feedback (order_id, user_id, was_ok, reason)
  values ('70000000-0000-4000-8000-00000000fb01',
          '11111111-1111-1111-1111-111111111111', false, 'late')
  $$,
  '23505'
);

-- =============================================================================
-- The cases that must be refused.
-- =============================================================================

select test_result.refused(
  'an order that has not arrived cannot be reviewed',
  $$
  insert into public.order_feedback (order_id, user_id, was_ok)
  values ('70000000-0000-4000-8000-00000000fb02',
          '11111111-1111-1111-1111-111111111111', true)
  $$,
  '42501'
);

select test_result.refused(
  'a failed delivery has a failure reason, not a customer review',
  $$
  insert into public.order_feedback (order_id, user_id, was_ok, reason)
  values ('70000000-0000-4000-8000-00000000fb04',
          '11111111-1111-1111-1111-111111111111', false, 'missing_item')
  $$,
  '42501'
);

select test_result.refused(
  'a customer cannot review somebody else''s delivered order',
  $$
  insert into public.order_feedback (order_id, user_id, was_ok)
  values ('70000000-0000-4000-8000-00000000fb03',
          '11111111-1111-1111-1111-111111111111', true)
  $$,
  '42501'
);

select test_result.refused(
  'a customer cannot write a row in another customer''s name',
  $$
  insert into public.order_feedback (order_id, user_id, was_ok)
  values ('70000000-0000-4000-8000-00000000fb03',
          '22222222-2222-2222-2222-222222222222', true)
  $$,
  '42501'
);

-- The three CHECK-constraint shapes. These run with RLS out of the way, so the
-- refusal is the constraint (23514) and not the insert policy (42501) — the two
-- must not be confused, or "the customer wrote a bad reason" would look proven
-- when all that happened was a permission denial.
-- =============================================================================

reset role;

select test_result.refused(
  '"all fine" cannot carry a complaint',
  $$
  insert into public.order_feedback (order_id, user_id, was_ok, reason)
  values ('70000000-0000-4000-8000-00000000fb03',
          '22222222-2222-2222-2222-222222222222', true, 'damaged')
  $$,
  '23514'
);

select test_result.refused(
  '"something was wrong" must carry a reason',
  $$
  insert into public.order_feedback (order_id, user_id, was_ok, reason)
  values ('70000000-0000-4000-8000-00000000fb03',
          '22222222-2222-2222-2222-222222222222', false, null)
  $$,
  '23514'
);

select test_result.refused(
  'a reason outside the fixed six is refused',
  $$
  insert into public.order_feedback (order_id, user_id, was_ok, reason)
  values ('70000000-0000-4000-8000-00000000fb03',
          '22222222-2222-2222-2222-222222222222', false, 'too_expensive')
  $$,
  '23514'
);

-- The owner may READ every answer but may not write one on a customer's behalf:
-- the insert policy is customer-only, on purpose.
set role authenticated;
select test_result.sign_in('33333333-3333-3333-3333-333333333333');

select test_result.refused(
  'the shop cannot answer on the customer''s behalf',
  $$
  insert into public.order_feedback (order_id, user_id, was_ok, reason)
  values ('70000000-0000-4000-8000-00000000fb03',
          '22222222-2222-2222-2222-222222222222', false, 'late')
  $$,
  '42501'
);

-- =============================================================================
-- Ravi answers his own order, with a real complaint.
-- =============================================================================

set role authenticated;
select test_result.sign_in('22222222-2222-2222-2222-222222222222');

select test_result.inserted(
  'a complaint needs a reason and is accepted with one',
  $$
  insert into public.order_feedback (order_id, user_id, was_ok, reason)
  values ('70000000-0000-4000-8000-00000000fb03',
          '22222222-2222-2222-2222-222222222222', false, 'damaged')
  $$
);

-- =============================================================================
-- Who can read what.
-- =============================================================================

select test_result.eq(
  'Ravi sees only his own answer, not Asha''s',
  (select count(*)::text from public.order_feedback),
  '1'
);

select test_result.eq(
  'Ravi cannot read Asha''s row even by its order id',
  (select count(*)::text from public.order_feedback
    where order_id = '70000000-0000-4000-8000-00000000fb01'),
  '0'
);

set role authenticated;
select test_result.sign_in('11111111-1111-1111-1111-111111111111');

select test_result.eq(
  'Asha still sees only her own answer once Ravi has written his',
  (select count(*)::text from public.order_feedback),
  '1'
);

set role authenticated;
select test_result.sign_in('44444444-4444-4444-4444-444444444444');

select test_result.eq(
  'the rider (staff) sees every answer — that is the correction loop',
  (select count(*)::text from public.order_feedback),
  '2'
);

set role authenticated;
select test_result.sign_in('33333333-3333-3333-3333-333333333333');

select test_result.eq(
  'the owner sees every answer',
  (select count(*)::text from public.order_feedback),
  '2'
);

-- =============================================================================
-- Immutable: no UPDATE policy, no DELETE policy. RLS makes the row invisible to
-- the write, so the statement succeeds changing nothing. Both directions are
-- checked, and for the admin too, so "nobody deletes history" is not an accident
-- of the customer policy alone.
-- =============================================================================

select test_result.touches(
  'the owner cannot rewrite a customer''s answer',
  $$
  update public.order_feedback set was_ok = true, reason = null
   where order_id = '70000000-0000-4000-8000-00000000fb03'
  $$,
  0
);

select test_result.touches(
  'the owner cannot delete a customer''s answer',
  $$
  delete from public.order_feedback
   where order_id = '70000000-0000-4000-8000-00000000fb03'
  $$,
  0
);

select test_result.eq(
  'the complaint is still exactly as Ravi left it',
  (select was_ok::text || ':' || reason
     from public.order_feedback
    where order_id = '70000000-0000-4000-8000-00000000fb03'),
  'false:damaged'
);

set role authenticated;
select test_result.sign_in('11111111-1111-1111-1111-111111111111');

select test_result.touches(
  'a customer cannot change her own answer after the fact',
  $$
  update public.order_feedback set was_ok = false, reason = 'late'
   where order_id = '70000000-0000-4000-8000-00000000fb01'
  $$,
  0
);

select test_result.touches(
  'a customer cannot delete her own answer either',
  $$
  delete from public.order_feedback
   where order_id = '70000000-0000-4000-8000-00000000fb01'
  $$,
  0
);

-- =============================================================================
-- Erasing an account takes its feedback away, and keeps the shop's ledger.
--
-- A throwaway customer, one delivered order, one answer. After
-- delete_my_account() the feedback row and the profile are gone, while the order
-- still exists under the tombstone.
-- =============================================================================

reset role;

insert into auth.users (id, phone, raw_user_meta_data) values
  ('f25f25f2-0000-4000-8000-00000000fb05', '+91980000fb05', '{"full_name":"Leaving Customer"}')
on conflict (id) do nothing;

set role authenticated;
select test_result.sign_in('33333333-3333-3333-3333-333333333333');

insert into public.orders (
  id, user_id, store_id, address_id, delivery_address,
  status, payment_method, payment_status,
  subtotal_paise, delivery_fee_paise, discount_paise, total_paise,
  delivered_at
)
values (
  '70000000-0000-4000-8000-00000000fb05',
  'f25f25f2-0000-4000-8000-00000000fb05',
  '00000000-0000-4000-8000-000000000001',
  null,
  '{"line1":"7, Market Road","pincode":"572130"}'::jsonb,
  'delivered', 'cod', 'paid', 2500, 0, 0, 2500, now()
)
on conflict (id) do nothing;

set role authenticated;
select test_result.sign_in('f25f25f2-0000-4000-8000-00000000fb05');

select test_result.inserted(
  'the throwaway customer answers before erasing the account',
  $$
  insert into public.order_feedback (order_id, user_id, was_ok, reason)
  values ('70000000-0000-4000-8000-00000000fb05',
          'f25f25f2-0000-4000-8000-00000000fb05', false, 'missing_item')
  $$
);

select public.delete_my_account();

reset role;

select test_result.eq(
  'erasing the account erased its feedback',
  (select count(*)::text from public.order_feedback
    where user_id = 'f25f25f2-0000-4000-8000-00000000fb05'),
  '0'
);

select test_result.eq(
  'the order survives, anonymised to the tombstone',
  (select user_id::text from public.orders
    where id = '70000000-0000-4000-8000-00000000fb05'),
  '00000000-0000-0000-0000-000000000d1d'
);

select test_result.eq(
  'and no feedback row survives on that order either',
  (select count(*)::text from public.order_feedback
    where order_id = '70000000-0000-4000-8000-00000000fb05'),
  '0'
);

-- =============================================================================
-- Cleanup: remove the orders this suite made. The feedback rows go with them
-- (ON DELETE CASCADE). The throwaway auth user is already gone.
-- =============================================================================

reset role;

delete from public.orders
 where id in ('70000000-0000-4000-8000-00000000fb01',
              '70000000-0000-4000-8000-00000000fb02',
              '70000000-0000-4000-8000-00000000fb03',
              '70000000-0000-4000-8000-00000000fb04',
              '70000000-0000-4000-8000-00000000fb05');

delete from public.profiles where id = 'f25f25f2-0000-4000-8000-00000000fb05';
delete from auth.users where id = 'f25f25f2-0000-4000-8000-00000000fb05';
