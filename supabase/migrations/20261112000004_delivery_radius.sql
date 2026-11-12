-- =============================================================================
-- 38 · How far is the door? A configurable radius, and a 30-minute promise
--
-- The shop has always decided delivery by PINCODE (`delivery_zones`). That is a
-- coarse rule: it cannot tell a house 2 km away from one 18 km away inside the
-- same pincode, and it cannot say "we are 14 minutes from you".
--
-- This migration adds the finer rule WITHOUT deleting the old one:
--
--   * when the shop has a pin AND the address has a pin, the DISTANCE decides.
--     Inside `delivery_radius_m` (default 10 000 m) the order is accepted even
--     if its pincode was never listed; outside it, the order is refused with
--     the distance and the radius, so the app can say exactly why.
--   * when either pin is missing, the pincode zone decides, exactly as before.
--     That keeps every existing address working on the day this ships.
--
-- Express is a separate promise, not a faster word for normal delivery:
-- `express_radius_m` (default 5 km), `express_eta_minutes` (default 30), its own
-- fee, and a cap on the number of units. A 60-bag order is not a 30-minute
-- order, and saying it is would be a lie the rider pays for.
--
-- Everything here is configurable from the owner's phone through
-- `update_delivery_settings()`. No code change is needed to go from 10 km to
-- 15 km, or from 30 minutes to 45.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Where the shop is.
--
-- Nullable on purpose. A shop that has not dropped its pin yet keeps the
-- pincode rule; the app says the distance is not known rather than inventing
-- one. The owner sets it once, from the delivery settings card.
-- -----------------------------------------------------------------------------

alter table public.stores
  add column if not exists lat double precision,
  add column if not exists lng double precision;

alter table public.stores
  drop constraint if exists stores_lat_valid,
  add constraint stores_lat_valid check (lat is null or (lat >= -90 and lat <= 90)),
  drop constraint if exists stores_lng_valid,
  add constraint stores_lng_valid check (lng is null or (lng >= -180 and lng <= 180));

comment on column public.stores.lat is
  'Shop latitude. Null until the owner drops the pin; distance checks then fall '
  'back to the pincode zone instead of guessing.';
comment on column public.stores.lng is 'Shop longitude. See lat.';

-- The promise made at checkout, frozen on the order. `delivery_zones.eta_minutes`
-- is the normal estimate for a pincode; this is what the customer was actually
-- told, which may be the express promise or the fallback.
alter table public.orders
  add column if not exists eta_minutes integer;

alter table public.orders
  drop constraint if exists orders_eta_minutes_valid,
  add constraint orders_eta_minutes_valid
    check (eta_minutes is null or eta_minutes > 0);

comment on column public.orders.eta_minutes is
  'The delivery estimate promised when the order was placed, in minutes. Null '
  'on orders written before this column existed.';

-- -----------------------------------------------------------------------------
-- 2. The knobs.
-- -----------------------------------------------------------------------------

alter table public.store_settings
  add column if not exists delivery_radius_m   integer not null default 10000,
  add column if not exists express_enabled     boolean not null default true,
  add column if not exists express_radius_m    integer not null default 5000,
  add column if not exists express_eta_minutes integer not null default 30,
  add column if not exists express_fee_paise   integer not null default 0,
  add column if not exists express_max_units   integer not null default 40;

alter table public.store_settings
  drop constraint if exists store_settings_delivery_radius_valid,
  add constraint store_settings_delivery_radius_valid
    check (delivery_radius_m between 500 and 50000),
  drop constraint if exists store_settings_express_radius_valid,
  add constraint store_settings_express_radius_valid
    check (express_radius_m between 500 and 50000),
  drop constraint if exists store_settings_express_within_radius,
  add constraint store_settings_express_within_radius
    check (express_radius_m <= delivery_radius_m),
  drop constraint if exists store_settings_express_eta_valid,
  add constraint store_settings_express_eta_valid
    check (express_eta_minutes between 10 and 180),
  drop constraint if exists store_settings_express_fee_valid,
  add constraint store_settings_express_fee_valid
    check (express_fee_paise >= 0),
  drop constraint if exists store_settings_express_units_valid,
  add constraint store_settings_express_units_valid
    check (express_max_units between 1 and 200);

comment on column public.store_settings.delivery_radius_m is
  'How far the shop delivers, in metres. 10000 = 10 km. Configurable from the '
  'owner''s phone; no code change needed to widen it.';
comment on column public.store_settings.express_enabled is
  'Whether the 30-minute (configurable) express service is offered at all.';
comment on column public.store_settings.express_radius_m is
  'Express is only promised inside this radius, in metres.';
comment on column public.store_settings.express_eta_minutes is
  'The express promise shown to the customer, in minutes. 30 today.';
comment on column public.store_settings.express_fee_paise is
  'Extra fee for express, in paise. Added on top of the delivery fee.';
comment on column public.store_settings.express_max_units is
  'Largest basket (sum of quantities) still promised in express time.';

-- -----------------------------------------------------------------------------
-- 3. The distance, in one place.
--
-- Haversine on a spherical earth of radius 6 371 000 m. The error against the
-- true ellipsoid is under ~0.5% at these distances — 50 m on a 10 km radius,
-- which is far smaller than the uncertainty in a dropped pin. A flat-earth
-- shortcut would be wrong by kilometres; PostGIS would be a dependency for a
-- precision the pin does not have.
--
-- The TypeScript mirror is `src/lib/geo.ts`, pinned by `npm run check:geo`.
-- -----------------------------------------------------------------------------

create or replace function public.distance_metres(
  p_lat1 double precision,
  p_lng1 double precision,
  p_lat2 double precision,
  p_lng2 double precision
)
returns double precision
language sql
immutable
as $$
  select 2 * 6371000 * asin(
    sqrt(
      power(sin(radians(p_lat2 - p_lat1) / 2), 2)
      + cos(radians(p_lat1)) * cos(radians(p_lat2))
        * power(sin(radians(p_lng2 - p_lng1) / 2), 2)
    )
  )
$$;

comment on function public.distance_metres(double precision, double precision, double precision, double precision) is
  'Great-circle distance in metres (haversine, R = 6 371 000 m). Null in, null out.';

-- -----------------------------------------------------------------------------
-- 4. What the checkout is allowed to say before the order is placed.
--
-- Read-only. It answers the customer's own address, and it says "unknown"
-- rather than "eligible" when either pin is missing.
-- -----------------------------------------------------------------------------

create or replace function public.delivery_quote(
  p_store_id   uuid,
  p_address_id uuid,
  p_units      integer default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid      uuid := auth.uid();
  v_address  public.addresses%rowtype;
  v_store    public.stores%rowtype;
  v_settings public.store_settings%rowtype;
  v_distance double precision;
  v_has_fix  boolean;
  v_express  boolean := false;
  v_reason   text;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'not_logged_in');
  end if;

  select * into v_address
    from public.addresses a
   where a.id = p_address_id and a.user_id = v_uid;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'address_not_found');
  end if;

  select * into v_store from public.stores s where s.id = p_store_id;
  select * into v_settings from public.store_settings ss where ss.store_id = p_store_id;

  if v_store.id is null or v_settings.id is null then
    return jsonb_build_object('ok', false, 'error', 'store_not_found');
  end if;

  v_has_fix := public.is_usable_fix(v_store.lat, v_store.lng)
           and public.is_usable_fix(v_address.lat, v_address.lng);

  if v_has_fix then
    v_distance := public.distance_metres(v_store.lat, v_store.lng, v_address.lat, v_address.lng);
  end if;

  if v_settings.express_enabled then
    if not v_has_fix then
      v_reason := 'no_location';
    elsif v_distance > v_settings.express_radius_m then
      v_reason := 'too_far';
    elsif p_units is not null and p_units > v_settings.express_max_units then
      v_reason := 'too_many_items';
    else
      v_express := true;
    end if;
  else
    v_reason := 'disabled';
  end if;

  return jsonb_build_object(
    'ok', true,
    'has_fix', v_has_fix,
    'distance_m', case when v_has_fix then round(v_distance)::integer else null end,
    'radius_m', v_settings.delivery_radius_m,
    'within_radius', case when v_has_fix
                          then v_distance <= v_settings.delivery_radius_m
                          else null end,
    'express_available', v_express,
    'express_reason', v_reason,
    'express_eta_minutes', v_settings.express_eta_minutes,
    'express_fee_paise', v_settings.express_fee_paise,
    'express_radius_m', v_settings.express_radius_m,
    'express_max_units', v_settings.express_max_units
  );
end;
$$;

comment on function public.delivery_quote(uuid, uuid, integer) is
  'Read-only distance and express eligibility for one of the caller''s own '
  'addresses. Says "unknown" (has_fix = false) rather than guessing when a pin '
  'is missing.';

revoke execute on function public.delivery_quote(uuid, uuid, integer) from public, anon;
grant execute on function public.delivery_quote(uuid, uuid, integer) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 5. The owner's write path.
--
-- One function, one transaction, both tables. Null means "leave alone", which
-- is what lets the card send only the field that changed. Every bound is checked
-- here with a message the owner can act on, not left to a constraint name.
-- -----------------------------------------------------------------------------

create or replace function public.update_delivery_settings(
  p_delivery_radius_m   integer default null,
  p_express_enabled     boolean default null,
  p_express_radius_m    integer default null,
  p_express_eta_minutes integer default null,
  p_express_fee_paise   integer default null,
  p_express_max_units   integer default null,
  p_lat                 double precision default null,
  p_lng                 double precision default null,
  p_clear_location      boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_settings public.store_settings%rowtype;
  v_store_id uuid;
begin
  if not public.is_admin() then
    raise exception 'Only the shop can change delivery settings.'
      using errcode = '42501';
  end if;

  select ss.* into v_settings
    from public.store_settings ss
    join public.stores s on s.id = ss.store_id
   where s.is_active
   order by s.created_at
   limit 1
   for update of ss;

  if not found then
    raise exception 'There is no shop settings row.' using errcode = 'P0002';
  end if;

  if p_delivery_radius_m is not null
     and (p_delivery_radius_m < 500 or p_delivery_radius_m > 50000) then
    raise exception 'Delivery radius must be between 500 m and 50 km.'
      using errcode = '22023';
  end if;

  if p_express_radius_m is not null
     and (p_express_radius_m < 500 or p_express_radius_m > 50000) then
    raise exception 'Express radius must be between 500 m and 50 km.'
      using errcode = '22023';
  end if;

  if p_express_radius_m is not null
     and p_express_radius_m > coalesce(p_delivery_radius_m, v_settings.delivery_radius_m) then
    raise exception 'Express radius cannot be larger than the delivery radius.'
      using errcode = '22023';
  end if;

  if p_express_eta_minutes is not null
     and (p_express_eta_minutes < 10 or p_express_eta_minutes > 180) then
    raise exception 'Express time must be between 10 and 180 minutes.'
      using errcode = '22023';
  end if;

  if p_express_fee_paise is not null and p_express_fee_paise < 0 then
    raise exception 'Express fee cannot be negative.' using errcode = '22023';
  end if;

  if p_express_max_units is not null
     and (p_express_max_units < 1 or p_express_max_units > 200) then
    raise exception 'Express basket limit must be between 1 and 200 units.'
      using errcode = '22023';
  end if;

  if (p_lat is null) <> (p_lng is null) then
    raise exception 'A shop pin needs both a latitude and a longitude.'
      using errcode = '22023';
  end if;

  if p_lat is not null and not public.is_usable_fix(p_lat, p_lng) then
    raise exception 'That shop pin is not a place on earth.' using errcode = '22023';
  end if;

  update public.store_settings
     set delivery_radius_m   = coalesce(p_delivery_radius_m, delivery_radius_m),
         express_enabled     = coalesce(p_express_enabled, express_enabled),
         express_radius_m    = coalesce(p_express_radius_m, express_radius_m),
         express_eta_minutes = coalesce(p_express_eta_minutes, express_eta_minutes),
         express_fee_paise   = coalesce(p_express_fee_paise, express_fee_paise),
         express_max_units   = coalesce(p_express_max_units, express_max_units),
         updated_at          = now()
   where id = v_settings.id
  returning * into v_settings;

  v_store_id := v_settings.store_id;

  if p_clear_location then
    update public.stores set lat = null, lng = null where id = v_store_id;
  elsif p_lat is not null then
    update public.stores set lat = p_lat, lng = p_lng where id = v_store_id;
  end if;

  return jsonb_build_object(
    'settings', to_jsonb(v_settings),
    'store', (select to_jsonb(s) from public.stores s where s.id = v_store_id)
  );
end;
$$;

comment on function public.update_delivery_settings(integer, boolean, integer, integer, integer, integer, double precision, double precision, boolean) is
  'Admin-only: the delivery radius, the express promise and the shop pin, in one '
  'transaction. Bounds are checked with actionable messages. Returns the stored '
  'settings and store row.';

revoke execute on function public.update_delivery_settings(integer, boolean, integer, integer, integer, integer, double precision, double precision, boolean) from public, anon;
grant execute on function public.update_delivery_settings(integer, boolean, integer, integer, integer, integer, double precision, double precision, boolean) to authenticated, service_role;
