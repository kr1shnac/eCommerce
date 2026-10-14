-- =============================================================================
-- 11 · products.emoji — the shelf picture, and who may touch it.
--
-- Rule 9.7: a schema change ships with a test. This column was added purely as
-- a customer-visible field, so there are three things worth pinning:
--
--   1. it exists, it is text, and it is allowed to be NULL (a product with a
--      photo, or one just created in the admin panel, must not be blocked);
--   2. the SEED really filled it in — an empty column would silently degrade
--      every tile back to the category leaf and nobody would notice;
--   3. it rides the EXISTING products policies: readable by a customer, not
--      writable by one. A new column is not automatically covered "because the
--      table has policies" — that is exactly the assumption 9.7 exists to test.
-- =============================================================================

select test_result.begin_suite('11 product emoji');

-- -----------------------------------------------------------------------------
-- Shape
-- -----------------------------------------------------------------------------

select test_result.eq(
  'products.emoji is a text column',
  (select data_type from information_schema.columns
    where table_schema = 'public' and table_name = 'products' and column_name = 'emoji'),
  'text'
);

select test_result.eq(
  'products.emoji is nullable',
  (select is_nullable from information_schema.columns
    where table_schema = 'public' and table_name = 'products' and column_name = 'emoji'),
  'YES'
);

-- -----------------------------------------------------------------------------
-- The seed filled it in. Two ends of the catalogue, so neither the first nor a
-- later INSERT block can silently lose the column without this noticing.
-- -----------------------------------------------------------------------------

select test_result.eq(
  'the seeded tomato carries its emoji',
  (select emoji from public.products where id = '20000000-0000-4000-8000-000000000001'),
  '🍅'
);

select test_result.eq(
  'the seeded toothpaste carries its emoji',
  (select emoji from public.products where id = '20000000-0000-4000-8000-000000000034'),
  '🪥'
);

-- -----------------------------------------------------------------------------
-- Existing RLS covers the new column.
-- -----------------------------------------------------------------------------

set role authenticated;
select test_result.sign_in('11111111-1111-1111-1111-111111111111');

select test_result.eq(
  'a customer can read a product emoji',
  (select emoji from public.products where id = '20000000-0000-4000-8000-000000000004'),
  '🍌'
);

-- An UPDATE the caller may not perform does not raise; it quietly matches no
-- rows. touches() is the honest assertion (see 00_auth_stub.sql).
select test_result.touches(
  'a customer cannot change a product emoji (0 rows touched)',
  $$
  update public.products set emoji = '💀'
    where id = '20000000-0000-4000-8000-000000000001'
  $$,
  0
);

-- -----------------------------------------------------------------------------
-- Data hygiene: the whole point of this build is that Kannada exists and is not
-- an English copy. Guard the seed against a future paste that forgets it.
-- -----------------------------------------------------------------------------

select test_result.eq(
  'no seeded product has Kannada identical to English',
  (select count(*) from public.products where name_kn = name_en),
  0
);

-- The shape's still there after all of the above (no accidental drop).
select test_result.eq(
  'the tomato emoji is unchanged at the end',
  (select emoji from public.products where id = '20000000-0000-4000-8000-000000000001'),
  '🍅'
);
