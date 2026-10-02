-- =============================================================================
-- 06 · Row Level Security (RLS) — the rules that keep customers separate
-- =============================================================================
--
-- PLAIN ENGLISH
-- -------------
-- Postgres has a feature called RLS. Once you switch it on for a table, EVERY
-- read and write goes through a policy, even queries from the Supabase admin
-- dashboard. Think of each policy as a sentence of the form:
--
--     "A <who> may <do what> <on which rows>"
--
-- `auth.uid()` is "the id of the person making this request" (null when nobody
-- is signed in). `public.is_admin()` asks the profiles table whether that
-- person has the admin role.
--
-- The three roles:
--   customer → a shopper. Can browse the catalogue, manage their own addresses
--              and orders, and nothing else.
--   delivery → the rider. Can see all orders and move them along the status
--              list, but cannot change prices or products.
--   admin    → the shop owner. Can manage everything.
--
-- IMPORTANT: RLS only protects data that comes in through the Supabase API. It
-- does nothing for the SQL editor (that is the owner, by design) and it does
-- nothing if you paste the service_role key into an app. That is exactly why the
-- mobile app must only ever hold the anon key.

-- -----------------------------------------------------------------------------
-- Turn RLS on everywhere. A table with RLS enabled and no policy is completely
-- invisible to the app, which is the safe default.
-- -----------------------------------------------------------------------------

alter table public.stores          enable row level security;
alter table public.profiles        enable row level security;
alter table public.categories      enable row level security;
alter table public.products        enable row level security;
alter table public.addresses       enable row level security;
alter table public.delivery_zones  enable row level security;
alter table public.store_settings  enable row level security;
alter table public.orders          enable row level security;
alter table public.order_items     enable row level security;

-- =============================================================================
-- stores
-- Browsing is public (a not-signed-in visitor must see the catalogue), but the
-- owner list is admin-only, and only an admin can edit a shop.
-- =============================================================================
create policy "anyone can read an active store"
  on public.stores for select
  to anon, authenticated
  using (is_active or public.is_admin());

create policy "admins manage stores"
  on public.stores for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- =============================================================================
-- profiles
-- You can see and edit only your own profile. Admins see everyone.
-- (The profiles_guard_role trigger stops you promoting yourself to admin, even
--  though this policy lets you update your own row.)
-- =============================================================================
create policy "you can read your own profile, admins read all"
  on public.profiles for select
  to authenticated
  using (id = auth.uid() or public.is_admin());

create policy "you can update your own profile, admins update all"
  on public.profiles for update
  to authenticated
  using (id = auth.uid() or public.is_admin())
  with check (id = auth.uid() or public.is_admin());

create policy "admins create profiles"
  on public.profiles for insert
  to authenticated
  with check (public.is_admin());

create policy "admins delete profiles"
  on public.profiles for delete
  to authenticated
  using (public.is_admin());

-- =============================================================================
-- categories
-- Customers and visitors see active categories only, so the owner can hide a
-- half-finished aisle by flipping is_active to false. Nobody but an admin can
-- change them.
-- =============================================================================
create policy "anyone can read active categories"
  on public.categories for select
  to anon, authenticated
  using (is_active or public.is_admin());

create policy "admins manage categories"
  on public.categories for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- =============================================================================
-- products
-- Same idea as categories: sold-out-from-the-shelf (is_active = false) products
-- disappear from the app, and only an admin can edit stock or price.
-- =============================================================================
create policy "anyone can read active products"
  on public.products for select
  to anon, authenticated
  using (is_active or public.is_admin());

create policy "admins manage products"
  on public.products for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- =============================================================================
-- addresses
-- The strictest table in the app: `user_id = auth.uid()` means you can only ever
-- see your own saved addresses. There is no id you can guess your way past.
-- =============================================================================
create policy "you can manage your own addresses"
  on public.addresses for all
  to authenticated
  using (user_id = auth.uid() or public.is_admin())
  with check (user_id = auth.uid() or public.is_admin());

-- =============================================================================
-- delivery_zones
-- Public, because the app must be able to answer "do we deliver to 571915, and
-- what is the fee?" before anyone signs in.
-- =============================================================================
create policy "anyone can read active delivery zones"
  on public.delivery_zones for select
  to anon, authenticated
  using (is_active or public.is_admin());

create policy "admins manage delivery zones"
  on public.delivery_zones for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- =============================================================================
-- store_settings
-- Public (minimum order, delivery fee, opening hours) and admin-writable.
-- =============================================================================
create policy "anyone can read store settings"
  on public.store_settings for select
  to anon, authenticated
  using (true);

create policy "admins manage store settings"
  on public.store_settings for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- =============================================================================
-- orders
-- A customer sees only their own orders. Staff (admin + delivery) see all of
-- them. Customers may create their own order and may update it, but the
-- orders_guard_update trigger then limits them to "placed -> cancelled" without
-- touching any money field.
-- =============================================================================
create policy "you can read your own orders, staff read all"
  on public.orders for select
  to authenticated
  using (user_id = auth.uid() or public.is_staff());

create policy "you can place your own order"
  on public.orders for insert
  to authenticated
  with check (user_id = auth.uid() or public.is_admin());

create policy "you can cancel your own order, staff can update any order"
  on public.orders for update
  to authenticated
  using (user_id = auth.uid() or public.is_staff())
  with check (user_id = auth.uid() or public.is_staff());

-- Orders are never deleted; they are cancelled. Only an admin may hard-delete.
create policy "admins delete orders"
  on public.orders for delete
  to authenticated
  using (public.is_admin());

-- =============================================================================
-- order_items
-- An order_item is visible exactly when its parent order is visible. The
-- EXISTS(...) check is re-run against the orders table, whose own RLS policy
-- applies, so a customer cannot read lines of somebody else's order.
-- =============================================================================
create policy "you can read items of orders you can see"
  on public.order_items for select
  to authenticated
  using (
    exists (
      select 1
      from public.orders o
      where o.id = order_id
        and (o.user_id = auth.uid() or public.is_staff())
    )
  );

create policy "you can add items to your own order"
  on public.order_items for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.orders o
      where o.id = order_id
        and (o.user_id = auth.uid() or public.is_admin())
    )
  );

create policy "admins update order items"
  on public.order_items for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy "admins delete order items"
  on public.order_items for delete
  to authenticated
  using (public.is_admin());