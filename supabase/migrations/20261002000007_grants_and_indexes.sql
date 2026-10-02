-- =============================================================================
-- 07 · Grants and indexes
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Grants: who is allowed to run which SQL verbs.
-- RLS (file 06) decides WHICH ROWS; grants decide WHETHER the table can be
-- touched at all. Both are needed.
-- -----------------------------------------------------------------------------
grant usage on schema public to anon, authenticated;

-- Visitors who have not signed in may only READ the public catalogue.
grant select on
  public.stores,
  public.categories,
  public.products,
  public.delivery_zones,
  public.store_settings
  to anon, authenticated;

-- Signed-in users get full table privileges on every table. That sounds wide
-- open, but it is not: RLS (file 06) is what limits them. Grants decide "can
-- this role touch the table at all", policies decide "which rows". Splitting it
-- the other way round would silently break the admin panel, which needs to
-- UPDATE products and categories.
grant select, insert, update, delete on all tables in schema public to authenticated;

grant usage, select on all sequences in schema public to authenticated;

-- Anything created by a future migration is covered automatically.
alter default privileges in schema public
  grant select on tables to anon, authenticated;
alter default privileges in schema public
  grant select, insert, update, delete on tables to authenticated;
alter default privileges in schema public
  grant usage, select on sequences to authenticated;

-- -----------------------------------------------------------------------------
-- Indexes: they make the queries the app actually runs fast.
-- Without these, every Home-screen load would scan the whole products table.
-- -----------------------------------------------------------------------------
create index categories_store_id_idx     on public.categories (store_id);
create index products_store_id_idx       on public.products (store_id);
create index products_category_id_idx    on public.products (category_id);

create index addresses_user_id_idx       on public.addresses (user_id);

create index delivery_zones_pincode_idx  on public.delivery_zones (pincode);

create index orders_user_id_idx          on public.orders (user_id, placed_at desc);
create index orders_store_id_idx         on public.orders (store_id, placed_at desc);
create index orders_status_idx           on public.orders (status);

create index order_items_order_id_idx    on public.order_items (order_id);