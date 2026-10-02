-- =============================================================================
-- 01 · Foundations: enums, the store table, shared helper functions
-- =============================================================================
-- Run order matters. Every file in supabase/migrations must be applied in
-- filename order (Supabase CLI does this for you).
--
-- Money rule for the whole project: every money column is named *_paise and is
-- a whole number of paise (1 rupee = 100 paise). Never a float, never rupees.

-- -----------------------------------------------------------------------------
-- Enums. A Postgres "enum" is a fixed list of allowed words.
-- -----------------------------------------------------------------------------

create type public.user_role as enum ('customer', 'admin', 'delivery');

create type public.order_status as enum (
  'placed',
  'confirmed',
  'packing',
  'out_for_delivery',
  'delivered',
  'cancelled'
);

create type public.payment_method as enum ('cod', 'online');

create type public.payment_status as enum ('pending', 'paid', 'failed', 'refunded');

-- -----------------------------------------------------------------------------
-- stores
-- The app talks to exactly one shop today, but every product/order/setting row
-- already carries a store_id. Adding a second shop later is a data change, not
-- a rewrite.
-- -----------------------------------------------------------------------------

create table public.stores (
  id           uuid primary key default gen_random_uuid(),
  name         text        not null,
  slug         text        not null unique,
  phone        text,
  address_line text,
  city         text,
  is_active    boolean     not null default true,
  created_at   timestamptz not null default now()
);

comment on table public.stores is
  'Shops that sell on this platform. One row today; the schema supports many.';

-- -----------------------------------------------------------------------------
-- set_updated_at(): keeps updated_at honest without the app having to.
-- -----------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- NOTE: the role helper functions (current_user_role / is_admin / is_delivery /
-- is_staff) are created in 02_profiles.sql instead, because they read
-- public.profiles and Postgres refuses to create a function whose body
-- references a table that does not exist yet.