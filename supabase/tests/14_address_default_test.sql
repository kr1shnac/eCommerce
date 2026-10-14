-- =============================================================================
-- 14 · addresses — at most one default, and set_default_address().
--
-- Rule 9.7: the partial unique index and the function are new schema, so here is
-- the proof. The interesting cases:
--
--   1. the index exists, and the database REALLY refuses a second default;
--   2. set_default_address() moves the default in one step, leaving exactly one;
--   3. it will not touch an address the caller does not own — and, crucially,
--      refuses WITHOUT having already cleared their current default;
--   4. signed out, it refuses outright.
-- =============================================================================

select test_result.begin_suite('14 address default');

-- -----------------------------------------------------------------------------
-- Shape
-- -----------------------------------------------------------------------------

select test_result.eq(
  'the one-default-per-user index exists',
  (
    select count(*) from pg_indexes
    where schemaname = 'public' and indexname = 'addresses_one_default_per_user'
  ),
  1::bigint
);

-- -----------------------------------------------------------------------------
-- The database refuses a second default, even from the table owner.
-- -----------------------------------------------------------------------------

select test_result.refused(
  'a second default address for one person is refused',
  $$update public.addresses set is_default = true
     where id = '50000000-0000-4000-8000-000000000002'$$,
  '23505'
);

-- -----------------------------------------------------------------------------
-- The allowed case: move the default with the function.
-- -----------------------------------------------------------------------------

set role authenticated;
select test_result.sign_in('11111111-1111-1111-1111-111111111111');

select test_result.ok(
  'set_default_address() switches the default',
  public.set_default_address('50000000-0000-4000-8000-000000000002')
);

select test_result.eq(
  'the new address is the default',
  (select id::text from public.addresses
    where user_id = '11111111-1111-1111-1111-111111111111' and is_default),
  '50000000-0000-4000-8000-000000000002'
);

select test_result.eq(
  'the customer still has exactly one default',
  (select count(*) from public.addresses
    where user_id = '11111111-1111-1111-1111-111111111111' and is_default),
  1::bigint
);

select test_result.eq(
  'the OLD default is no longer marked default',
  (select is_default::text from public.addresses
    where id = '50000000-0000-4000-8000-000000000001'),
  'false'
);

-- -----------------------------------------------------------------------------
-- The forbidden case: another person's address.
-- -----------------------------------------------------------------------------

select test_result.refused(
  'setting somebody else''s address as default is refused (P0002)',
  $$select public.set_default_address('50000000-0000-4000-8000-000000000004')$$,
  'P0002'
);

select test_result.eq(
  'the refused call did NOT clear the caller''s own default',
  (select id::text from public.addresses
    where user_id = '11111111-1111-1111-1111-111111111111' and is_default),
  '50000000-0000-4000-8000-000000000002'
);

-- Look as the owner: RLS hides Ravi's address from Asha, so this cannot be
-- checked while still signed in as her.
reset role;
select test_result.eq(
  'the other customer''s address is untouched',
  (select is_default::text from public.addresses
    where id = '50000000-0000-4000-8000-000000000004'),
  'true'
);

-- -----------------------------------------------------------------------------
-- Signed out: no default to change.
-- -----------------------------------------------------------------------------

set role authenticated;
select test_result.sign_out();

select test_result.refused(
  'setting a default while signed out is refused (42501)',
  $$select public.set_default_address('50000000-0000-4000-8000-000000000002')$$,
  '42501'
);

reset role;
