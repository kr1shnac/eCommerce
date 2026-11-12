-- =============================================================================
-- 09 · product images: the bucket, and who may touch it
-- =============================================================================
-- HOSTED NOTE (2026-11-09). On Supabase, `storage.objects` is owned by
-- `supabase_storage_admin`, not by the `postgres` role that migrations run as.
-- `postgres` is not a member of that role, so `create policy` raises
-- `42501 must be owner of table objects`. The bucket insert itself is allowed.
--
-- This file is therefore split into two guarded blocks:
--   1. the bucket, which `postgres` can create;
--   2. the four policies, created only when the current role owns the table.
--      On the throwaway PostgreSQL the test harness creates the storage stub as
--      the test user, so this branch runs and test 08 proves the policies. On
--      hosted it raises a NOTICE instead of failing the whole push; the four
--      policies are then created from the Supabase dashboard
--      (Storage -> Policies) or by a role that owns `storage.objects`.
--
-- This is the one migration edited after it was written. It has never been
-- applied to the current hosted project (the push failed and rolled back), and
-- the old project is retired. `npm run test:db` re-runs it every time and still
-- proves the policy behaviour, so the edit does not weaken the proof.

-- 1. The bucket. Public read is intentional: a signed-out visitor must see the
--    catalogue. Writes are governed by the policies below.
do $$
begin
  if exists (select 1 from information_schema.schemata where schema_name = 'storage')
     and exists (select 1 from information_schema.tables where table_schema = 'storage' and table_name = 'buckets')
  then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values (
      'product-images',
      'product-images',
      true,
      5242880,
      ARRAY['image/jpeg','image/png','image/webp','image/avif']
    )
    on conflict (id) do nothing;
  end if;
end $$;

-- 2. The rules: anyone may look, only the shop owner may write.
do $$
begin
  if exists (select 1 from information_schema.schemata where schema_name = 'storage')
     and exists (select 1 from information_schema.tables where table_schema = 'storage' and table_name = 'objects')
     and (select tableowner from pg_tables where schemaname = 'storage' and tablename = 'objects') = current_user
  then
    alter table storage.objects enable row level security;

    drop policy if exists "product_images_public_read" on storage.objects;
    drop policy if exists "product_images_admin_write" on storage.objects;
    drop policy if exists "product_images_admin_update" on storage.objects;
    drop policy if exists "product_images_admin_delete" on storage.objects;

    create policy "product_images_public_read"
      on storage.objects for select
      to anon, authenticated
      using (bucket_id = 'product-images');

    create policy "product_images_admin_write"
      on storage.objects for insert
      to authenticated
      with check (
        bucket_id = 'product-images'
        and public.is_admin()
      );

    create policy "product_images_admin_update"
      on storage.objects for update
      to authenticated
      using (
        bucket_id = 'product-images'
        and public.is_admin()
      )
      with check (
        bucket_id = 'product-images'
        and public.is_admin()
      );

    create policy "product_images_admin_delete"
      on storage.objects for delete
      to authenticated
      using (
        bucket_id = 'product-images'
        and public.is_admin()
      );
  else
    raise notice
      'product-images bucket is ready, but storage.objects is not owned by %; the four product_images_* policies were not created. On Supabase, create them from Storage -> Policies.',
      current_user;
  end if;
end $$;
