-- =============================================================================
-- 23 · One phone, several adults (register H10)
--
-- Rule 9.7: a new function is not done until a test proves the forbidden case
-- fails. `set_my_name()` is the one write the app had for the account's own name,
-- and it is narrow on purpose.
--
-- The four things this file exists to prove, in order of how much they matter:
--
--   1. **IT CAN ONLY TOUCH YOUR OWN ROW.** The function takes no user id, so there
--      is no id to tamper with. Even called by an admin, it acts on `auth.uid()`
--      and nobody else — an admin renames their own account through it, not the
--      customer's. This is the assertion that would fail the day somebody adds a
--      `p_user_id` argument "for convenience".
--
--   2. **IT CANNOT CHANGE A ROLE.** A customer calling it stays a customer. The
--      function writes `full_name` and nothing else; `profiles_guard_role` would
--      refuse a role change anyway, and this proves the function never offers one.
--
--   3. **A BLANK NAME IS REFUSED, NOT STORED.** A stored blank is indistinguishable
--      from "never set", and the account screen cannot then tell the customer which
--      state they are in.
--
--   4. **A SIGNED-OUT CALLER IS REFUSED LOUDLY** with `42501`, not zero rows and no
--      error — the failure mode that makes a save button lie (rule 9.4).
--
-- It also pins the happy path and that the value STORED is the value returned, so
-- the screen can show the truth rather than an echo of what it sent.
-- =============================================================================

select test_result.begin_suite('23 my name');

-- The three seeded people (see supabase/tests/support/02_fixtures.sql):
--   1111… = customer, 2222… = rider, 3333… = admin.

-- -----------------------------------------------------------------------------
-- 1. A signed-out caller is refused, loudly
-- -----------------------------------------------------------------------------

reset role;
set role authenticated;

select test_result.sign_out();
select test_result.refused(
  'a signed-out caller cannot set a name',
  $$ select public.set_my_name('Nobody') $$,
  '42501'
);

-- -----------------------------------------------------------------------------
-- 2. A customer can name their own account
-- -----------------------------------------------------------------------------

select test_result.sign_in('11111111-1111-1111-1111-111111111111');

select test_result.ok(
  'a signed-in customer can set their own name',
  (select (public.set_my_name('Ramesh Gowda')).full_name = 'Ramesh Gowda'),
  'the function returned the stored row'
);

-- The value in the table is the value, not a hopeful echo. This is the same claim
-- the shelf edit makes, and it is the one a screen depends on (rule 9.1).
select test_result.eq(
  'the stored name is the name that was set',
  (select full_name from public.profiles where id = '11111111-1111-1111-1111-111111111111'),
  'Ramesh Gowda'
);

-- Names arrive with stray whitespace from a phone keyboard. It is trimmed, so a
-- leading space cannot make two different strings out of one name.
select test_result.eq(
  'the name is trimmed before it is stored',
  (select (public.set_my_name('  Suma  ')).full_name),
  'Suma'
);

select test_result.eq(
  'the trimmed name is what the table holds',
  (select full_name from public.profiles where id = '11111111-1111-1111-1111-111111111111'),
  'Suma'
);

-- A name with spaces, a hyphen or an initial is a real name, not a validation
-- failure. The town's names must not be squeezed into a pattern.
select test_result.ok(
  'a name with spaces and a hyphen is accepted',
  (select (public.set_my_name('M. K. Ramesh-Gowda')).full_name = 'M. K. Ramesh-Gowda'),
  'the function accepted it'
);

-- A Kannada name is the common case here, not the exotic one.
select test_result.ok(
  'a Kannada name is accepted',
  (select (public.set_my_name('ರಮೇಶ್ ಗೌಡ')).full_name = 'ರಮೇಶ್ ಗೌಡ'),
  'the function accepted a Kannada name'
);

-- -----------------------------------------------------------------------------
-- 3. A blank name is refused, not stored
-- -----------------------------------------------------------------------------

select test_result.refused(
  'a blank name is refused',
  $$ select public.set_my_name('   ') $$,
  '23514'
);

select test_result.refused(
  'a null name is refused',
  $$ select public.set_my_name(null) $$,
  '23514'
);

-- Refusing must not have quietly cleared the name that was already there. A guard
-- that erases on the way to saying no is worse than no guard.
select test_result.eq(
  'a refused save leaves the existing name alone',
  (select full_name from public.profiles where id = '11111111-1111-1111-1111-111111111111'),
  'ರಮೇಶ್ ಗೌಡ'
);

select test_result.refused(
  'an absurdly long name is refused',
  $$ select public.set_my_name(repeat('a', 500)) $$,
  '23514'
);

-- -----------------------------------------------------------------------------
-- 4. It can never reach another person's row
-- -----------------------------------------------------------------------------

-- The rider sets a name. The customer's row must be untouched: this is what fails
-- the day somebody adds a user id argument.
select test_result.sign_in('22222222-2222-2222-2222-222222222222');
select test_result.ok(
  'the rider can name their own account',
  (select (public.set_my_name('Rider 23')).full_name = 'Rider 23'),
  'the rider set their own name'
);

-- Read the customer's row back AS THE CUSTOMER. RLS is doing its job here: a rider
-- cannot read another person's profile at all, so checking from the rider's session
-- would return zero rows for the right reason and prove nothing. This assertion is
-- the one that fails the day somebody adds a user id argument to `set_my_name()`.
select test_result.sign_in('11111111-1111-1111-1111-111111111111');
select test_result.eq(
  'the rider setting a name did NOT change the customer',
  (select full_name from public.profiles where id = '11111111-1111-1111-1111-111111111111'),
  'ರಮೇಶ್ ಗೌಡ'
);

select test_result.ok(
  'the function has no user-id argument to misuse',
  not exists (
    select 1 from pg_proc
     where proname = 'set_my_name'
       and (pg_get_function_arguments(oid) ilike '%user_id%'
            or pg_get_function_arguments(oid) ilike '%p_id%')
  ),
  'no user id in the signature'
);

-- Even the ADMIN renames only their own account through this function. The owner
-- renames a customer from the Team screen, not from here — and a function that
-- could rename anyone would be an account-takeover surface reachable by a screen.
select test_result.sign_in('33333333-3333-3333-3333-333333333333');

select test_result.ok(
  'the admin can name their own account too',
  (select (public.set_my_name('Admin 23')).full_name = 'Admin 23'),
  'the admin set their own name'
);

-- The admin CAN read every profile (the policy allows it), so reading the
-- customer's row here proves the admin's own rename did not touch it.
select test_result.eq(
  'the admin setting a name did NOT change the customer',
  (select full_name from public.profiles where id = '11111111-1111-1111-1111-111111111111'),
  'ರಮೇಶ್ ಗೌಡ'
);

-- -----------------------------------------------------------------------------
-- 5. It cannot change a role
-- -----------------------------------------------------------------------------
-- The customer calls the function, then is still a customer — proven by reading
-- the row back, and by the role guard's own behaviour.

select test_result.sign_in('11111111-1111-1111-1111-111111111111');
select test_result.ok(
  'the customer can still name their account after the checks above',
  (select (public.set_my_name('Ramesh Again')).full_name = 'Ramesh Again'),
  'the function still works'
);

select test_result.eq(
  'setting a name left the role alone',
  (select role::text from public.profiles where id = '11111111-1111-1111-1111-111111111111'),
  'customer'
);

-- And the underlying guard still refuses a smuggled role change, so this test
-- would notice if `set_my_name()` ever grew a way to pass one through.
select test_result.refused(
  'a plain self-promotion to admin is still refused',
  $$ update public.profiles set role = 'admin' where id = auth.uid() $$,
  '42501'
);

select test_result.eq(
  'the refused promotion left the role a customer',
  (select role::text from public.profiles where id = '11111111-1111-1111-1111-111111111111'),
  'customer'
);

-- -----------------------------------------------------------------------------
-- 6. The delivery is still addressed to the person, not the account
-- -----------------------------------------------------------------------------
-- This is the fact that makes the household model WORK, and it was already built.
-- An address carries its own `full_name`, so one shared phone can book to different
-- people. Pinning it here means a future "tidy-up" of the address schema cannot
-- quietly remove the household's ability to name the person receiving the bag.

select test_result.ok(
  'an address keeps its own recipient name, separate from the account',
  exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'addresses' and column_name = 'full_name'
  ),
  'addresses.full_name exists'
);

select test_result.ok(
  'the order snapshots the recipient name, so history is not rewritten',
  exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'orders' and column_name = 'delivery_address'
  ),
  'orders.delivery_address exists'
);

-- Restore the fixtures to the names the seed gave them (see
-- supabase/tests/support/02_fixtures.sql), so a suite that runs after this one
-- sees what it expects. Deliberately restores the real values rather than nulling
-- them: a test that leaves the world different from how it found it is a test that
-- makes the next failure harder to read.
reset role;

update public.profiles set full_name = 'Asha'
 where id = '11111111-1111-1111-1111-111111111111';

update public.profiles set full_name = 'Ravi'
 where id = '22222222-2222-2222-2222-222222222222';

update public.profiles set full_name = 'Shop Owner'
 where id = '33333333-3333-3333-3333-333333333333';
