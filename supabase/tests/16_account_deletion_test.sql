-- =============================================================================
-- 16 · account deletion — erasing a person without erasing the shop's books.
--
-- Rule 9.7: the migration is not done until this proves the FORBIDDEN cases
-- fail as well as the allowed one. Deletion is the single most dangerous
-- function in the schema: it is `security definer`, so a mistake in it erases
-- the wrong person or the wrong shop's ledger.
--
-- What is asserted:
--   1. shape: the function exists, is security definer, and is not executable by
--      `anon`;
--   2. the allowed case: a customer deletes themselves, and afterwards
--        * their profile is nameless and phoneless,
--        * their addresses are gone,
--        * their orders SURVIVE, anonymised, with the money untouched,
--        * the auth user is gone,
--        * a different customer is completely untouched;
--   3. the refusals:
--        * a signed-out caller is refused,
--        * the tombstone cannot delete itself,
--        * the only admin cannot delete themselves,
--        * the tombstone cannot be renamed, given a phone, promoted, or deleted.
-- =============================================================================

select test_result.begin_suite('16 account deletion');

-- -----------------------------------------------------------------------------
-- Shape
-- -----------------------------------------------------------------------------

select test_result.ok(
  'delete_my_account() exists',
  exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname = 'delete_my_account')
);

select test_result.eq(
  'delete_my_account() is security definer',
  (select p.prosecdef::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'delete_my_account'),
  'true'
);

select test_result.eq(
  'anon cannot execute delete_my_account()',
  has_function_privilege('anon', 'public.delete_my_account()', 'execute')::text,
  'false'
);

select test_result.eq(
  'authenticated can execute delete_my_account()',
  has_function_privilege('authenticated', 'public.delete_my_account()', 'execute')::text,
  'true'
);

select test_result.eq(
  'delete_my_account() takes no arguments (nothing to forge)',
  (select p.pronargs from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'delete_my_account'),
  0::smallint
);

select test_result.eq(
  'the tombstone guard trigger exists',
  (select count(*) from pg_trigger t
    where t.tgrelid = 'public.profiles'::regclass
      and t.tgname = 'profiles_guard_deleted' and not t.tgisinternal),
  1::bigint
);

-- -----------------------------------------------------------------------------
-- A customer with a real order to lose.
-- -----------------------------------------------------------------------------
-- A fresh user, so this suite cannot disturb the fixtures the earlier suites
-- rely on. Asha (1111…) is left alone on purpose: she has orders from tests 02
-- and 03, and "another customer is untouched" is one of the assertions.

reset role;

insert into auth.users (id, phone, raw_user_meta_data) values
  ('99999999-9999-9999-9999-999999999999', '+919800000099', '{"full_name":"Leaving"}')
on conflict (id) do nothing;

update public.profiles
set role = 'customer', full_name = 'Leaving', phone = '+919800000099'
where id = '99999999-9999-9999-9999-999999999999';

insert into public.addresses (id, user_id, label, full_name, phone, line1, city, pincode, is_default)
values
  ('50000000-0000-4000-8000-000000000099', '99999999-9999-9999-9999-999999999999',
   'Home', 'Leaving', '+919800000099', '9, Departing Street', 'Kunigal', '572130', true)
on conflict (id) do nothing;

-- An order placed as this user. Uses the same fixtures as test 02 so the money
-- is believable: one unit of whatever the fixture product is.
set role authenticated;
select test_result.sign_in('99999999-9999-9999-9999-999999999999');

select test_result.ok(
  'the leaving customer can place an order',
  (
    select (public.place_order(
      -- \u20b918 a tomato, and the shop's minimum is \u20b9100, so this is a real
      -- basket rather than a token order. 6 x 1800 = 10800 paise.
      '[{"product_id":"20000000-0000-4000-8000-000000000001","quantity":6}]',
      '00000000-0000-4000-8000-000000000001',
      '50000000-0000-4000-8000-000000000099',
      'erasure-test-key-0001'
    ) ->> 'ok')::boolean
  )
);

reset role;

select test_result.ok(
  'the leaving customer really has an order',
  (select count(*) from public.orders
    where user_id = '99999999-9999-9999-9999-999999999999') = 1
);

-- Remember the money, so it can be proved unchanged by the erasure.
create temporary table erasure_money as
select order_number, total_paise, subtotal_paise, delivery_fee_paise, discount_paise
  from public.orders where user_id = '99999999-9999-9999-9999-999999999999';

-- -----------------------------------------------------------------------------
-- The refusal: signed out
-- -----------------------------------------------------------------------------

reset role;
select test_result.sign_out();

do $$
begin
  perform public.delete_my_account();
  perform test_result.ok('signed-out deletion was refused', false);
exception
  when insufficient_privilege then
    perform test_result.ok('signed-out deletion is refused', true);
  when others then
    perform test_result.ok('signed-out deletion is refused', false,
      'wrong error: ' || sqlerrm);
end;
$$;

-- -----------------------------------------------------------------------------
-- The allowed case
-- -----------------------------------------------------------------------------

set role authenticated;
select test_result.sign_in('99999999-9999-9999-9999-999999999999');

-- Note: this also exercises the admin second-admin check's negative path — this
-- user is a plain customer, so no second-admin rule applies.
select test_result.ok(
  'the customer can delete their own account',
  (select (public.delete_my_account() ->> 'accounts_erased')::int) = 1
);

reset role;

-- 1. The person is gone from profiles.
select test_result.eq(
  'the profile row is gone entirely',
  (select count(*) from public.profiles
    where id = '99999999-9999-9999-9999-999999999999'),
  0::bigint
);

-- 2. Addresses are gone.
select test_result.eq(
  'every address of the deleted customer is gone',
  (select count(*) from public.addresses
    where user_id = '99999999-9999-9999-9999-999999999999'),
  0::bigint
);

-- 3. The auth user is gone, so the number can sign up fresh.
select test_result.eq(
  'the auth user is gone (the number can sign up again)',
  (select count(*) from auth.users
    where id = '99999999-9999-9999-9999-999999999999'),
  0::bigint
);

-- 4. The order SURVIVED and is owned by the tombstone.
select test_result.eq(
  'the order survived',
  (select count(*) from public.orders o
    where o.order_number in (select order_number from erasure_money)),
  1::bigint
);

select test_result.eq(
  'the order now belongs to the tombstone',
  (select count(*) from public.orders o
    where o.order_number in (select order_number from erasure_money)
      and o.user_id = public.deleted_customer_id()),
  1::bigint
);

-- 5. The money is byte-for-byte what it was. This is the assertion that matters
--    for the shop: erasure must never touch the books.
select test_result.eq(
  'the order money is untouched by erasure',
  (select count(*) from public.orders o
     join erasure_money m using (order_number)
    where o.total_paise = m.total_paise
      and o.subtotal_paise = m.subtotal_paise
      and o.delivery_fee_paise = m.delivery_fee_paise
      and o.discount_paise = m.discount_paise),
  1::bigint
);

select test_result.eq(
  'the order still satisfies its own totals CHECK',
  (select count(*) from public.orders o
     join erasure_money m using (order_number)
    where o.total_paise = o.subtotal_paise + o.delivery_fee_paise - o.discount_paise),
  1::bigint
);

-- 6. The delivery snapshot no longer names anybody.
select test_result.eq(
  'the delivery address snapshot is anonymised',
  (select o.delivery_address ->> 'full_name'
     from public.orders o
     join erasure_money m using (order_number)),
  'Deleted customer'
);

select test_result.eq(
  'the delivery snapshot keeps no phone number',
  (select o.delivery_address ->> 'phone'
     from public.orders o
     join erasure_money m using (order_number)),
  ''
);

select test_result.ok(
  'the erased order has no link back to a saved address',
  (select o.address_id is null
     from public.orders o
     join erasure_money m using (order_number))
);

-- 7. Another customer is untouched. Asha still has her profile and her orders.
select test_result.ok(
  'another customer is completely untouched',
  exists (select 1 from public.profiles
           where id = '11111111-1111-1111-1111-111111111111')
  and exists (select 1 from public.addresses
               where user_id = '11111111-1111-1111-1111-111111111111')
);

-- -----------------------------------------------------------------------------
-- The refusals: the tombstone itself
-- -----------------------------------------------------------------------------

select test_result.ok(
  'the tombstone profile exists after a deletion',
  exists (select 1 from public.profiles where id = public.deleted_customer_id())
);

select test_result.eq(
  'the tombstone is a plain customer',
  (select role::text from public.profiles where id = public.deleted_customer_id()),
  'customer'
);

do $$
begin
  update public.profiles set full_name = 'Somebody'
   where id = public.deleted_customer_id();
  perform test_result.ok('the tombstone cannot be renamed', false);
exception
  when restrict_violation then
    perform test_result.ok('the tombstone cannot be renamed', true);
  when others then
    perform test_result.ok('the tombstone cannot be renamed', false, sqlerrm);
end;
$$;

do $$
begin
  update public.profiles set phone = '+919800000000'
   where id = public.deleted_customer_id();
  perform test_result.ok('the tombstone cannot be given a phone number', false);
exception
  when restrict_violation then
    perform test_result.ok('the tombstone cannot be given a phone number', true);
  when others then
    perform test_result.ok('the tombstone cannot be given a phone number', false, sqlerrm);
end;
$$;

do $$
begin
  update public.profiles set role = 'admin'
   where id = public.deleted_customer_id();
  perform test_result.ok('the tombstone cannot be promoted to admin', false);
exception
  when restrict_violation then
    perform test_result.ok('the tombstone cannot be promoted to admin', true);
  when others then
    perform test_result.ok('the tombstone cannot be promoted to admin', false, sqlerrm);
end;
$$;

do $$
begin
  delete from public.profiles where id = public.deleted_customer_id();
  perform test_result.ok('the tombstone cannot be deleted', false);
exception
  when restrict_violation then
    perform test_result.ok('the tombstone cannot be deleted', true);
  when others then
    perform test_result.ok('the tombstone cannot be deleted', false, sqlerrm);
end;
$$;

-- -----------------------------------------------------------------------------
-- The refusal: the only admin
-- -----------------------------------------------------------------------------
--
-- This uses its OWN throwaway admin, never the shared fixture admin
-- (33333333…). The first version of this suite deleted the shared one, and
-- because run.sh runs this file before the shell race test, the shop's own
-- transaction in test 04 then ran as a user that no longer existed, silently
-- failed, and released its row lock instantly — so the race test failed for a
-- reason that had nothing to do with racing. A test may create its own fixtures
-- and must clean them up; it may not eat another test's.

reset role;
select test_result.sign_out();

-- The shop's only admin, for the length of this block. The shared fixture owner
-- (33333333…) is demoted rather than deleted, so nothing depends on him being
-- gone and nothing has to be re-created afterwards.
update public.profiles set role = 'customer'
 where id = '33333333-3333-3333-3333-333333333333';

insert into auth.users (id, phone, raw_user_meta_data) values
  ('77777777-7777-7777-7777-777777777777', '+919800000077', '{"full_name":"Lone Owner"}')
on conflict (id) do nothing;
update public.profiles set role = 'admin' where id = '77777777-7777-7777-7777-777777777777';

set role authenticated;
select test_result.sign_in('77777777-7777-7777-7777-777777777777');

do $$
begin
  perform public.delete_my_account();
  perform test_result.ok('the only admin cannot delete themselves', false);
exception
  when restrict_violation then
    perform test_result.ok('the only admin cannot delete themselves', true);
  when others then
    perform test_result.ok('the only admin cannot delete themselves', false, sqlerrm);
end;
$$;

-- Give the shop a second admin, and the door opens. This is register H9 seen
-- from the other side: the same missing second admin that locks the owner out
-- is the one that blocks his deletion.
reset role;
insert into auth.users (id, phone, raw_user_meta_data) values
  ('88888888-8888-8888-8888-888888888888', '+919800000088', '{"full_name":"Second Owner"}')
on conflict (id) do nothing;
update public.profiles set role = 'admin' where id = '88888888-8888-8888-8888-888888888888';

set role authenticated;
select test_result.sign_in('77777777-7777-7777-7777-777777777777');

select test_result.ok(
  'with a second admin, an admin may delete themselves',
  (select (public.delete_my_account() ->> 'accounts_erased')::int) = 1
);

reset role;

-- Put every shared fixture back exactly as it was, so the suites that run after
-- this one (and the shell race test) find the world they expect. The tombstone
-- and the erased orders are the only things this suite is allowed to leave.
select test_result.sign_out();
delete from auth.users where id = '88888888-8888-8888-8888-888888888888';
update public.profiles set role = 'admin' where id = '33333333-3333-3333-3333-333333333333';
