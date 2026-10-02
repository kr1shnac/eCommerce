-- =============================================================================
-- 04 · addresses (saved delivery addresses, owned by the customer)
-- =============================================================================
-- Rule: a customer may only ever see and touch their OWN rows.
-- There is no store_id here because an address belongs to a person, not a shop.

create table public.addresses (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid        not null references public.profiles (id) on delete cascade,
  label      text,
  full_name  text        not null,
  phone      text        not null,
  line1      text        not null,
  line2      text,
  landmark   text,
  city       text        not null default 'Kunigal',
  state      text        not null default 'Karnataka',
  pincode    text        not null,
  is_default boolean     not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.addresses is
  'Saved delivery addresses. RLS limits every row to its owner (or an admin).';

create trigger addresses_set_updated_at
  before update on public.addresses
  for each row execute function public.set_updated_at();