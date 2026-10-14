-- =============================================================================
-- 13 · favourites — saving a product, and who may touch whose shortlist.
--
-- Rule 9.7: a new table is not done until a test proves the FORBIDDEN case
-- fails. `favourites` is customer-owned data, so the interesting assertions are
-- all about one person being unable to see or change another person's shelf:
--
--   1. shape: the composite primary key really is (user_id, product_id), and
--      RLS is switched on;
--  2. a customer can save one of their own, read it back, and remove it;
--  3. the SAME product cannot be saved twice (the PK is the whole point);
--  6. a customer cannot read, write, or delete a row that is not theirs.
-- =============================================================================

select test_result.begin_suite('13 favourites');

-- demo.sql (run by test 12, just before this) seeds a shortlist for Asha so the
-- Home "Saved" rail is not empty. These assertions are about counts, so start
-- from a known, empty shelf rather than inheriting whatever the demo left.
reset role;
delete from public.favourites
 where user_id in (
   '11111111-1111-1111-1111-111111111111',
   '22222222-2222-2222-2222-222222222222'
 );

-- -----------------------------------------------------------------------------
-- Shape
-- -----------------------------------------------------------------------------

select test_result.eq(
  'favourites has row level security enabled',
  (select relrowsecurity::text from pg_class where oid = 'public.favourites'::regclass),
  'true'
);

select test_result.eq(
  'favourites primary key is (user_id, product_id)',
  (
    select string_agg(a.attname, ',' order by a.attname)
    from pg_index i
    join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any (i.indkey)
    where i.indrelid = 'public.favourites'::regclass and i.indisprimary
  ),
  'product_id,user_id'
);

select test_result.eq(
  'favourites has a policy for customers',
  (select count(*) from pg_policies
    where schemaname = 'public' and tablename = 'favourites' and policyname = 'you manage your own favourites'),
  1::bigint
);

-- -----------------------------------------------------------------------------
-- The allowed case: a customer saves one of their own products.
-- -----------------------------------------------------------------------------

set role authenticated;
select test_result.sign_in('11111111-1111-1111-1111-111111111111');

select test_result.inserted(
  'a customer can save one of their own products',
  $$
  insert into public.favourites (user_id, product_id)
  values ('11111111-1111-1111-1111-111111111111', '20000000-0000-4000-8000-000000000004')
  $$
);

select test_result.eq(
  'the customer can read back their own favourite',
  (select count(*) from public.favourites
    where user_id = '11111111-1111-1111-1111-111111111111'),
  1::bigint
);

-- A product may be saved once and only once. Re-saving the SAME one must fail on
-- the primary key (23505), not quietly create a second row.
select test_result.refused(
  'saving the same product twice is refused',
  $$
  insert into public.favourites (user_id, product_id)
  values ('11111111-1111-1111-1111-111111111111', '20000000-0000-4000-8000-000000000004')
  $$,
  '23505'
);

-- -----------------------------------------------------------------------------
-- The forbidden cases: another customer's shelf is invisible and untouchable.
-- -----------------------------------------------------------------------------

-- Ravi's favourite, written by the owner so it exists regardless of RLS.
reset role;
insert into public.favourites (user_id, product_id)
values ('22222222-2222-2222-2222-222222222222', '20000000-0000-4000-8000-000000000002')
on conflict do nothing;

set role authenticated;
select test_result.sign_in('11111111-1111-1111-1111-111111111111');

select test_result.eq(
  'a customer cannot even see another customer''s favourite',
  (select count(*) from public.favourites where user_id = '22222222-2222-2222-2222-222222222222'),
  0::bigint
);

-- Saving a favourite ON BEHALF OF somebody else must be refused (42501).
select test_result.refused(
  'a customer cannot save a favourite for another customer',
  $$
  insert into public.favourites (user_id, product_id)
  values ('22222222-2222-2222-2222-222222222222', '20000000-0000-4000-8000-000000000003')
  $$,
  '42501'
);

-- Deleting a row you cannot see affects zero rows, so it cannot remove it.
select test_result.touches(
  'a customer cannot delete another customer''s favourite (0 rows touched)',
  $$delete from public.favourites where user_id = '22222222-2222-2222-2222-222222222222'$$,
  0
);

-- Prove it survived by looking as the owner: RLS hides it from Asha, which is
-- exactly why the count above is 0 and this one is 1.
reset role;
select test_result.eq(
  'the other customer''s favourite is still there',
  (select count(*) from public.favourites where user_id = '22222222-2222-2222-2222-222222222222'),
  1::bigint
);

-- -----------------------------------------------------------------------------
-- The customer can still tidy their own shelf.
-- -----------------------------------------------------------------------------

set role authenticated;
select test_result.sign_in('11111111-1111-1111-1111-111111111111');

select test_result.touches(
  'a customer can delete their own favourite',
  $$delete from public.favourites where product_id = '20000000-0000-4000-8000-000000000004'$$,
  1
);

reset role;
select test_result.eq(
  'the customer''s shelf is empty again',
  (select count(*) from public.favourites where user_id = '11111111-1111-1111-1111-111111111111'),
  0::bigint
);
