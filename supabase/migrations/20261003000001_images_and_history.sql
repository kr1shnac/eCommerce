-- Wrap storage section for test harness (storage schema may not exist in throwaway PG)
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
  end if;
end $$;