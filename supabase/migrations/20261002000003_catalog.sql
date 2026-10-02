-- =============================================================================
-- 03 · Catalogue: categories and products
-- =============================================================================
-- Every text field that a customer can see comes in two languages:
--   *_en = English,  *_kn = Kannada
-- Adding a third language means adding one more column, not a rewrite.

create table public.categories (
  id         uuid primary key default gen_random_uuid(),
  store_id   uuid        not null references public.stores (id) on delete cascade,
  name_en    text        not null,
  name_kn    text        not null,
  icon       text,
  sort_order integer     not null default 0,
  is_active  boolean     not null default true,
  created_at timestamptz not null default now(),

  unique (store_id, name_en)
);

comment on column public.categories.icon is
  'Short emoji or icon key, used as the category chip icon and image fallback.';

create table public.products (
  id          uuid primary key default gen_random_uuid(),
  store_id    uuid        not null references public.stores (id) on delete cascade,
  category_id uuid        references public.categories (id) on delete set null,
  name_en     text        not null,
  name_kn     text        not null,
  price_paise integer     not null check (price_paise >= 0),
  mrp_paise   integer              check (mrp_paise is null or mrp_paise >= 0),
  unit        text        not null,
  stock_qty   integer     not null default 0 check (stock_qty >= 0),
  image_url   text,
  sort_order  integer     not null default 0,
  is_active   boolean     not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  unique (store_id, name_en)
);

comment on column public.products.price_paise is
  'Selling price in PAISE (integer). 4999 means Rs 49.99. Never store rupees.';
comment on column public.products.mrp_paise is
  'Printed "was" price in PAISE (integer). NULL when there is no discount.';
comment on column public.products.unit is
  'Pack size shown to the customer, e.g. "500 g", "1 L", "4 pcs". Free text.';

create trigger products_set_updated_at
  before update on public.products
  for each row execute function public.set_updated_at();