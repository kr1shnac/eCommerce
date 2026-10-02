-- =============================================================================
-- 05 · Orders: delivery_zones, store_settings, orders, order_items
-- =============================================================================

-- -----------------------------------------------------------------------------
-- delivery_zones: which pincodes the shop delivers to, and what it charges.
-- The fee is per zone, so the owner can charge more for far-away pincodes.
-- -----------------------------------------------------------------------------

create table public.delivery_zones (
  id                 uuid primary key default gen_random_uuid(),
  store_id           uuid        not null references public.stores (id) on delete cascade,
  pincode            text        not null,
  area_name_en       text,
  area_name_kn       text,
  delivery_fee_paise integer     not null default 0 check (delivery_fee_paise >= 0),
  eta_minutes        integer     check (eta_minutes is null or eta_minutes > 0),
  is_active          boolean     not null default true,
  created_at         timestamptz not null default now(),

  unique (store_id, pincode)
);

comment on table public.delivery_zones is
  'Pincodes the shop delivers to, with the delivery fee for each (in paise).';

-- -----------------------------------------------------------------------------
-- store_settings: one row per store (shop-wide knobs).
-- -----------------------------------------------------------------------------

create table public.store_settings (
  id                        uuid primary key default gen_random_uuid(),
  store_id                  uuid        not null unique references public.stores (id) on delete cascade,
  min_order_value_paise     integer     not null default 0 check (min_order_value_paise >= 0),
  delivery_fee_paise        integer     not null default 2500 check (delivery_fee_paise >= 0),
  free_delivery_above_paise integer     check (free_delivery_above_paise is null or free_delivery_above_paise >= 0),
  open_time                 time,
  close_time                time,
  is_open                   boolean     not null default true,
  support_phone             text,
  updated_at                timestamptz not null default now(),

  constraint store_settings_open_before_close
    check (open_time is null or close_time is null or open_time < close_time)
);

comment on column public.store_settings.min_order_value_paise is
  'Smallest basket the shop accepts, in paise. 10000 = Rs 100.';
comment on column public.store_settings.delivery_fee_paise is
  'Default delivery fee in paise when the pincode has no zone-specific fee.';

create trigger store_settings_set_updated_at
  before update on public.store_settings
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- orders
--
-- Two ideas worth knowing:
--   1. delivery_address is a SNAPSHOT (jsonb copy of the address at checkout).
--      If the customer edits their saved address tomorrow, past orders must still
--      show where the bag actually went.
--   2. order_items also snapshot the product name and price, so a price change
--      or a deleted product never rewrites history.
-- -----------------------------------------------------------------------------

create sequence public.order_number_seq as bigint start 1001;

create table public.orders (
  id               uuid primary key default gen_random_uuid(),
  order_number     text        not null unique
                     default ('KNG-' || lpad(nextval('public.order_number_seq')::text, 5, '0')),
  user_id          uuid        not null references public.profiles (id) on delete restrict,
  store_id         uuid        not null references public.stores (id) on delete restrict,
  address_id       uuid        references public.addresses (id) on delete set null,
  delivery_address jsonb       not null default '{}'::jsonb,
  status           public.order_status     not null default 'placed',
  payment_method   public.payment_method   not null,
  payment_status   public.payment_status   not null default 'pending',
  subtotal_paise   integer     not null check (subtotal_paise >= 0),
  delivery_fee_paise integer   not null default 0 check (delivery_fee_paise >= 0),
  discount_paise   integer     not null default 0 check (discount_paise >= 0),
  total_paise      integer     not null check (total_paise >= 0),
  notes            text,
  placed_at        timestamptz not null default now(),
  delivered_at     timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  -- The four money columns can never disagree with each other.
  constraint orders_totals_add_up
    check (total_paise = subtotal_paise + delivery_fee_paise - discount_paise)
);

comment on column public.orders.delivery_address is
  'Copy of the delivery address as it was at checkout (jsonb).';
comment on column public.orders.total_paise is
  'Grand total in paise. Always subtotal + delivery fee - discount.';

create trigger orders_set_updated_at
  before update on public.orders
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- order_items
-- line_total_paise is a GENERATED column: Postgres computes it, so it can never
-- be wrong. A customer cannot send a fake total.
-- -----------------------------------------------------------------------------

create table public.order_items (
  id                uuid primary key default gen_random_uuid(),
  order_id          uuid        not null references public.orders (id) on delete cascade,
  product_id        uuid        references public.products (id) on delete set null,
  product_name_en   text        not null,
  product_name_kn   text        not null,
  unit              text        not null,
  image_url         text,
  price_paise       integer     not null check (price_paise >= 0),
  quantity          integer     not null check (quantity > 0),
  line_total_paise  integer     generated always as (price_paise * quantity) stored
);

comment on column public.order_items.line_total_paise is
  'Auto-computed as price_paise * quantity. Never set this by hand.';

-- -----------------------------------------------------------------------------
-- Guard rails
-- RLS decides WHICH rows a person may touch. These triggers decide HOW a row is
-- allowed to change, so a clever customer cannot post a fake order.
-- -----------------------------------------------------------------------------

create or replace function public.guard_order_insert()
returns trigger
language plpgsql
as $$
begin
  -- A customer can only ever create a freshly placed, unpaid order.
  if public.current_user_role() = 'customer' then
    new.status := 'placed';
    new.payment_status := 'pending';
    new.placed_at := now();
  end if;

  return new;
end;
$$;

create trigger orders_guard_insert
  before insert on public.orders
  for each row execute function public.guard_order_insert();

create or replace function public.guard_order_update()
returns trigger
language plpgsql
as $$
begin
  -- Admin: full control, nothing to check.
  if public.is_admin() then
    return new;
  end if;

  -- Delivery partner: may move the order along, but may not touch prices,
  -- quantities, the customer or the delivery address.
  if public.current_user_role() = 'delivery' then
    if new.status is distinct from old.status
       or new.delivered_at is distinct from old.delivered_at
       or new.payment_status is distinct from old.payment_status then
      if new.order_number is not distinct from old.order_number
         and new.user_id is not distinct from old.user_id
         and new.store_id is not distinct from old.store_id
         and new.address_id is not distinct from old.address_id
         and new.delivery_address is not distinct from old.delivery_address
         and new.payment_method is not distinct from old.payment_method
         and new.subtotal_paise is not distinct from old.subtotal_paise
         and new.delivery_fee_paise is not distinct from old.delivery_fee_paise
         and new.discount_paise is not distinct from old.discount_paise
         and new.total_paise is not distinct from old.total_paise
         and new.notes is not distinct from old.notes
         and new.placed_at is not distinct from old.placed_at then
        return new;
      end if;
    end if;

    raise exception 'Delivery partners may only change status, payment_status and delivered_at.';
  end if;

  -- Customer: may cancel, but only while the order is still unconfirmed, and
  -- may not touch any money or identity field while doing it.
  if old.status = 'placed'
     and new.status = 'cancelled'
     and new.user_id is not distinct from old.user_id
     and new.store_id is not distinct from old.store_id
     and new.address_id is not distinct from old.address_id
     and new.delivery_address is not distinct from old.delivery_address
     and new.payment_method is not distinct from old.payment_method
     and new.payment_status is not distinct from old.payment_status
     and new.subtotal_paise is not distinct from old.subtotal_paise
     and new.delivery_fee_paise is not distinct from old.delivery_fee_paise
     and new.discount_paise is not distinct from old.discount_paise
     and new.total_paise is not distinct from old.total_paise
     and new.notes is not distinct from old.notes
     and new.placed_at is not distinct from old.placed_at
     and new.delivered_at is not distinct from old.delivered_at then
    return new;
  end if;

  raise exception 'Customers may only cancel an order that is still placed.';
end;
$$;

create trigger orders_guard_update
  before update on public.orders
  for each row execute function public.guard_order_update();

-- Same idea for order_items: while an order is still 'placed' the customer may
-- build the basket. Once the shop confirms it, the basket is frozen.
create or replace function public.guard_order_item_insert()
returns trigger
language plpgsql
as $$
begin
  if public.current_user_role() = 'customer' then
    if (select o.status from public.orders o where o.id = new.order_id) <> 'placed' then
      raise exception 'This order can no longer be changed.';
    end if;
  end if;

  return new;
end;
$$;

create trigger order_items_guard_insert
  before insert on public.order_items
  for each row execute function public.guard_order_item_insert();