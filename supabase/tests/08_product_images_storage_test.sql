-- =============================================================================
-- 08 · product-images bucket rules.
--
-- Migration 20261003000001_images_and_history.sql creates four policies on
-- storage.objects:
--     product_images_public_read    select  to anon, authenticated  using (bucket_id = 'product-images')
--     product_images_admin_write    insert to authenticated         with check (bucket_id and is_admin())
--     product_images_admin_update   update to authenticated         using / with check (same)
--     product_images_admin_delete   delete to authenticated         using (same)
--
-- The rule they encode: anyone may look at a product photo, because the app has
-- to render the catalogue to a signed-out visitor, but only the shop owner may
-- put one there, change one or remove one.
--
-- WHY THIS FILE IS NOT VACUOUS
-- 20261003000001 wraps its whole body in
--   if exists (storage schema) and exists (storage.buckets) ...
-- On a bare PostgreSQL neither exists, so before support/00_auth_stub.sql grew a
-- storage stub the migration did nothing at all and none of these policies
-- existed. The first group below therefore asserts that the bucket row and the
-- four policies are actually present. If someone tightens that guard again, this
-- file fails loudly instead of quietly testing nothing.
--
-- The refusals here are only meaningful because the grants are real: the stub
-- grants insert/update/delete to `authenticated`, and the "the shop owner can
-- upload" assertion proves it. Without that, "a customer cannot upload" would
-- pass on a missing GRANT rather than on the policy.
-- =============================================================================

select test_result.begin_suite('08a product-images storage rules exist at all');

-- -----------------------------------------------------------------------------
-- The migration's guarded block really ran.
-- -----------------------------------------------------------------------------

select test_result.ok(
  'the product-images bucket was created',
  exists (select 1 from storage.buckets where id = 'product-images')
);

select test_result.eq(
  'and it is a public bucket, so the CDN may serve it without a session',
  (select public::text from storage.buckets where id = 'product-images'),
  'true'
);

select test_result.eq(
  'and it caps uploads at 5 MB',
  (select file_size_limit from storage.buckets where id = 'product-images'),
  5242880
);

select test_result.eq(
  'and it allows only image types',
  (select array_to_string(allowed_mime_types, ',') from storage.buckets where id = 'product-images'),
  'image/jpeg,image/png,image/webp,image/avif'
);

select test_result.eq(
  'row level security is on for storage.objects',
  (select relrowsecurity::text from pg_class where oid = 'storage.objects'::regclass),
  'true'
);

-- All four policies, by name. A typo in a policy name would otherwise leave the
-- table wide open with every test below still "passing" for the wrong reason.
select test_result.eq(
  'all four product-images policies exist',
  (select count(*) from pg_policies
     where schemaname = 'storage' and tablename = 'objects'
       and policyname in ('product_images_public_read', 'product_images_admin_write',
                          'product_images_admin_update', 'product_images_admin_delete')),
  4
);

-- A starting row, owned by the shop, that the tests below read, edit and remove.
reset role;
insert into storage.objects (bucket_id, name, owner)
values ('product-images', 'seeded/tomato.jpg', '33333333-3333-3333-3333-333333333333');
delete from storage.buckets where id = 'some-other-bucket';
insert into storage.buckets (id, name, public) values ('some-other-bucket', 'invoices', false);

-- =============================================================================
-- Anyone may read. The catalogue has to render to a signed-out visitor.
-- =============================================================================

select test_result.begin_suite('08b reading a product photo is public');

set role anon;
select test_result.sign_out();

select test_result.eq(
  'a signed-out visitor can see the photo',
  (select count(*) from storage.objects where bucket_id = 'product-images'),
  1
);

-- ...but a public READ policy is not a public WRITE policy.
select test_result.refused(
  'a signed-out visitor cannot upload a photo',
  $$
  insert into storage.objects (bucket_id, name, owner)
  values ('product-images', 'anon/tomato.jpg', null)
  $$,
  '42501'
);

-- =============================================================================
-- A signed-in customer still cannot upload.
-- =============================================================================

select test_result.begin_suite('08c only the shop owner can write');

set role authenticated;
select test_result.sign_in('11111111-1111-1111-1111-111111111111');   -- Asha, customer

select test_result.eq(
  'a customer can still READ the photo',
  (select count(*) from storage.objects where bucket_id = 'product-images'),
  1
);

select test_result.refused(
  'a customer cannot upload a photo',
  $$
  insert into storage.objects (bucket_id, name, owner)
  values ('product-images', 'customer/tomato.jpg', '11111111-1111-1111-1111-111111111111')
  $$,
  '42501'
);

-- Update and delete hide rows rather than raising, so they are row counts.
select test_result.touches(
  'a customer cannot rename a photo (0 rows touched)',
  $$
  update storage.objects set name = 'customer/renamed.jpg'
    where bucket_id = 'product-images'
  $$,
  0
);

select test_result.touches(
  'a customer cannot delete a photo (0 rows touched)',
  $$
  delete from storage.objects where bucket_id = 'product-images'
  $$,
  0
);

-- The rider is staff. Staff move orders; staff do not restock the photo library.
select test_result.sign_in('44444444-4444-4444-4444-444444444444');   -- Rider, delivery

select test_result.refused(
  'the rider cannot upload a photo',
  $$
  insert into storage.objects (bucket_id, name, owner)
  values ('product-images', 'rider/tomato.jpg', '44444444-4444-4444-4444-444444444444')
  $$,
  '42501'
);

select test_result.touches(
  'the rider cannot delete a photo (0 rows touched)',
  $$
  delete from storage.objects where bucket_id = 'product-images'
  $$,
  0
);

-- =============================================================================
-- The shop owner can do all of it.
-- =============================================================================

select test_result.sign_in('33333333-3333-3333-3333-333333333333');   -- Owner, admin

select test_result.touches(
  'the shop owner really can upload a photo',
  $$
  insert into storage.objects (bucket_id, name, owner)
  values ('product-images', 'owner/onion.jpg', '33333333-3333-3333-3333-333333333333')
  $$,
  1
);

select test_result.touches(
  'the shop owner really can rename a photo',
  $$
  update storage.objects set name = 'owner/onion-2.jpg'
    where bucket_id = 'product-images' and name = 'owner/onion.jpg'
  $$,
  1
);

select test_result.touches(
  'the shop owner really can delete a photo',
  $$
  delete from storage.objects
    where bucket_id = 'product-images' and name = 'owner/onion-2.jpg'
  $$,
  1
);

-- =============================================================================
-- is_admin() is not enough on its own: bucket_id is checked too.
--
-- Without the `bucket_id = 'product-images'` clause in the WITH CHECK, being an
-- admin would let the shop owner write into every bucket in the project. This is
-- the assertion that keeps that clause honest.
-- =============================================================================

select test_result.refused(
  'even the shop owner cannot write into a different bucket',
  $$
  insert into storage.objects (bucket_id, name, owner)
  values ('some-other-bucket', 'owner/private.pdf', '33333333-3333-3333-3333-333333333333')
  $$,
  '42501'
);

select test_result.touches(
  'and cannot delete from a different bucket (0 rows touched)',
  $$
  delete from storage.objects where bucket_id = 'some-other-bucket'
  $$,
  0
);

-- =============================================================================
-- Nothing the non-admins tried actually landed.
-- =============================================================================

reset role;

select test_result.eq(
  'exactly the seeded photo is left in product-images',
  (select count(*) from storage.objects where bucket_id = 'product-images'),
  1
);

select test_result.eq(
  'it is still the one the fixtures put there',
  (select name from storage.objects where bucket_id = 'product-images'),
  'seeded/tomato.jpg'
);

select test_result.eq(
  'and the other bucket is empty — no admin escape hatch was used',
  (select count(*) from storage.objects where bucket_id = 'some-other-bucket'),
  0
);
