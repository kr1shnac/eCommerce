-- =============================================================================
-- 20261026000001 · Rider position: where the bag actually is
-- =============================================================================
-- This is register T4 of SCALE-AND-TRACKING.md §8, and the first half of the
-- "has he picked it up yet?" problem. Two things land here:
--
--   1. `orders.picked_up_at` — a fact, not a status. Right now
--      `out_for_delivery` means BOTH "a rider has been assigned" and "the bag is
--      on the bike", so a customer reads "Out for delivery" while the bag is
--      still on the counter. That is a small lie, and this project's standard
--      is refusing small lies. A rider taps once when they take the bag; the
--      timestamp is the truth and the ladder gains a real stop.
--
--   2. `rider_positions` — one row per rider, the position they are at now. Not
--      a trail. There is no history table and there will not be one: a trail is
--      a log of where an employee went all day, which nobody here consented to
--      and nobody here needs (SCALE-AND-TRACKING.md §6.6 rule 5).
--
-- THE THREE RULES THIS SCHEMA ENFORCES, AND WHERE
--
--   * A rider is tracked ONLY while carrying an order. `record_my_position()`
--     refuses outright when the caller has no `out_for_delivery` order assigned,
--     and this table has no direct write path at all (RLS on, every privilege
--     revoked, no policies). Bypassing the rule requires the service_role key,
--     which is not in the app.
--
--   * The position disappears the moment the delivery ends.
--     `clear_rider_position_on_close()` deletes the row when an order leaves
--     `out_for_delivery`. "No delivery, no stored position" is therefore true
--     even for a rider who forgot to close the app.
--
--   * A customer sees a position, never a breadcrumb. The view
--     `order_rider_position` exposes lat, lng, age and (when the destination has
--     coordinates) distance and ETA — and only for that customer's own order,
--     only while it is out for delivery, only if it is fresher than ten minutes,
--     and never to another rider.
--
-- WHY THE DESTINATION NEEDS `addresses.lat/lng`
--
-- The ETA in the design is a distance from the rider to the door, and until now
-- nothing in this database knew where a door is. `addresses` had text only.
-- These two nullable columns are that missing fact. Nothing populates them yet —
-- the address screen has to ask for them — so the view returns `null` for
-- distance and ETA until then, and the app shows position and age alone. The
-- columns exist now so the arithmetic below can be proved correct by a database
-- test rather than waiting on a device.
--
-- WHY `double precision` AND NOT THE INTEGER-PAISE RULE
--
-- AGENTS.md §2 rule 1 is about MONEY. Latitude is not money: it is a measured
-- quantity with a real uncertainty of metres, and PostGIS itself stores
-- geometry as double precision. Six decimal places of a numeric type would
-- imply 0.1 m precision that a phone does not have. This is the one place in
-- the schema where a float is the honest type, and the reason is written here
-- so it is not "fixed" by somebody applying the money rule too broadly.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Where a delivery goes.
-- -----------------------------------------------------------------------------

alter table public.addresses
  add column if not exists lat double precision,
  add column if not exists lng double precision;

alter table public.addresses
  add constraint addresses_lat_range
    check (lat is null or (lat >= -90 and lat <= 90)),
  add constraint addresses_lng_range
    check (lng is null or (lng >= -180 and lng <= 180)),
  -- (0,0) is "Null Island", in the Atlantic. It is what a location library
  -- returns after it has failed but been asked for something. Storing it would
  -- put a customer's front door in the ocean and poison every ETA computed from
  -- it.
  add constraint addresses_not_null_island
    check (not (lat = 0 and lng = 0));

comment on column public.addresses.lat is
  'Latitude of the delivery door. NULL until the address screen captures it; '
  'the rider position view returns no distance or ETA while it is NULL.';
comment on column public.addresses.lng is
  'Longitude of the delivery door. See lat.';

-- -----------------------------------------------------------------------------
-- 2. Where the rider is now. One row per rider, overwritten in place.
-- -----------------------------------------------------------------------------

create table if not exists public.rider_positions (
  -- The rider is the key. Upserting on it is what makes this "current position"
  -- rather than "position history": there is exactly one row per person, so
  -- there is nothing to mine.
  rider_id    uuid primary key
                references public.profiles (id) on delete cascade,

  -- Which delivery this fix belongs to. Kept so the view can refuse to show a
  -- position for an order the rider is no longer on. `set null` rather than
  -- `cascade`: deleting an order should not silently delete the row that proves
  -- who was where.
  order_id    uuid references public.orders (id) on delete set null,

  lat         double precision not null check (lat >= -90 and lat <= 90),
  lng         double precision not null check (lng >= -180 and lng <= 180),

  -- Horizontal accuracy as the phone reported it. Nullable: some fixes do not
  -- carry one, and a missing accuracy is not a reason to refuse a position.
  -- The view hides anything worse than 150 m (see MAX_USABLE_ACCURACY_M in
  -- src/lib/tracking-rules.ts) — a 500 m circle is not "where he is".
  accuracy_m  numeric(7, 1) check (accuracy_m is null or accuracy_m >= 0),

  recorded_at timestamptz not null default now(),

  constraint rider_positions_not_null_island
    check (not (lat = 0 and lng = 0))
);

comment on table public.rider_positions is
  'The current position of each delivery partner, one row per rider, written '
  'only through record_my_position() while an order is out for delivery. There '
  'is deliberately no history table: see SCALE-AND-TRACKING.md §6.6 rule 5.';
comment on column public.rider_positions.order_id is
  'The delivery this fix belongs to. The customer view shows a position only '
  'for the order it was recorded against, and only while that rider is still '
  'assigned to it.';

-- Direct access is closed. Every read goes through the view and every write
-- through the function, both of which enforce a rule a policy cannot express
-- ("only while carrying an order"). No policies are defined on purpose: with RLS
-- enabled and none present, the table is invisible to every client role — the
-- safe default, per AGENTS.md §3.
alter table public.rider_positions enable row level security;
revoke all on public.rider_positions from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 3. The two pieces of arithmetic, in the database so the app cannot invent them.
-- -----------------------------------------------------------------------------

-- Great-circle distance in metres. Same formula as distanceMetres() in
-- src/lib/tracking-rules.ts, and the two are asserted against each other by
-- supabase/tests/24_rider_positions_test.sql so they cannot drift apart.
create or replace function public.metres_between(
  p_lat1 double precision,
  p_lng1 double precision,
  p_lat2 double precision,
  p_lng2 double precision
)
returns double precision
language sql
immutable
set search_path = ''
as $$
  select 2 * 6371000 * asin(least(1, sqrt(
    power(sin(radians(p_lat2 - p_lat1) / 2), 2)
    + cos(radians(p_lat1)) * cos(radians(p_lat2))
      * power(sin(radians(p_lng2 - p_lng1) / 2), 2)
  )));
$$;

comment on function public.metres_between(double precision, double precision, double precision, double precision) is
  'Haversine distance in metres. The server owns this number so the app cannot '
  'invent a friendlier one.';

-- The ETA, and the reasons for its shape:
--   * 5.5 m/s (~20 km/h) is deliberately slow. An ETA that is beaten reads as
--     good service; one that is missed reads as a broken promise.
--   * Floored at 3 minutes: "arriving in 1 minute" is a promise a shop cannot
--     keep.
--   * NULL beyond 45 minutes: past that the number is fiction, and the screen
--     should say "on the way" rather than a wrong time.
create or replace function public.eta_minutes_for(p_distance_m double precision)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case
    when p_distance_m is null or p_distance_m < 0 then null
    when ceil(p_distance_m / 5.5 / 60) <= 3 then 3
    when ceil(p_distance_m / 5.5 / 60) > 45 then null
    else ceil(p_distance_m / 5.5 / 60)::integer
  end;
$$;

comment on function public.eta_minutes_for(double precision) is
  'Minutes from a straight-line distance at 5.5 m/s, floored at 3 and NULL '
  'beyond 45. Mirrors etaMinutesFor() in src/lib/tracking-rules.ts.';

-- -----------------------------------------------------------------------------
-- 4. The only write path: the rider's own phone, while carrying an order.
-- -----------------------------------------------------------------------------

create or replace function public.record_my_position(
  p_lat double precision,
  p_lng double precision,
  p_accuracy_m numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid      uuid := auth.uid();
  v_order_id uuid;
  v_recorded timestamptz;
begin
  -- 1. Somebody must be signed in. A rider id is never accepted as an argument:
  --    the only person whose position you can write is yourself, so there is no
  --    parameter to tamper with. (Same reasoning as delete_my_account() and
  --    set_my_name().)
  if v_uid is null then
    raise exception 'Sign in before recording a position.'
      using errcode = '42501';
  end if;

  -- 2. Only a delivery partner has a position worth recording.
  if public.current_user_role() is distinct from 'delivery' then
    raise exception 'Only a delivery partner can record a position.'
      using errcode = '42501';
  end if;

  -- 3. A fix that is not a place is not stored. The table checks enforce this
  --    too; raising here produces a message a developer can act on instead of a
  --    bare constraint violation.
  if p_lat is null or p_lng is null then
    raise exception 'A position needs both a latitude and a longitude.'
      using errcode = '22023';
  end if;
  if p_lat < -90 or p_lat > 90 or p_lng < -180 or p_lng > 180 then
    raise exception 'Latitude must be -90..90 and longitude -180..180.'
      using errcode = '22023';
  end if;
  if p_lat = 0 and p_lng = 0 then
    raise exception '0,0 is what a failed location lookup returns, not a place.'
      using errcode = '22023';
  end if;
  if p_accuracy_m is not null and p_accuracy_m < 0 then
    raise exception 'Accuracy cannot be negative.'
      using errcode = '22023';
  end if;

  -- 4. THE PRIVACY RULE. No active delivery, no position — full stop. This is
  --    checked before anything is written, so an idle rider is never tracked
  --    even by a buggy client that calls this every second.
  select o.id into v_order_id
  from public.orders o
  where o.assigned_to = v_uid
    and o.status = 'out_for_delivery'
  order by o.assigned_at desc nulls last
  limit 1;

  if v_order_id is null then
    raise exception 'Positions are recorded only while you are out delivering an order.'
      using errcode = '42501';
  end if;

  -- 5. One row per rider, overwritten. `recorded_at` is the server's clock, not
  --    the phone's: a rider whose clock is ten minutes fast would otherwise
  --    look permanently stale to every customer.
  insert into public.rider_positions as rp
    (rider_id, order_id, lat, lng, accuracy_m, recorded_at)
  values
    (v_uid, v_order_id, p_lat, p_lng, p_accuracy_m, now())
  on conflict (rider_id) do update
    set order_id    = excluded.order_id,
        lat         = excluded.lat,
        lng         = excluded.lng,
        accuracy_m  = excluded.accuracy_m,
        recorded_at = excluded.recorded_at
  returning rp.recorded_at into v_recorded;

  return jsonb_build_object(
    'lat', p_lat,
    'lng', p_lng,
    'recorded_at', v_recorded
  );
end;
$$;

comment on function public.record_my_position(double precision, double precision, numeric) is
  'Upsert the caller''s current position. Takes no rider id — it acts on '
  'auth.uid() only. Refuses unless the caller is a delivery partner with an '
  'out_for_delivery order assigned, so an idle rider is never tracked.';

revoke all on function public.record_my_position(double precision, double precision, numeric)
  from public, anon;
grant execute on function public.record_my_position(double precision, double precision, numeric)
  to authenticated;

-- -----------------------------------------------------------------------------
-- 5. The only read path for a customer: a position, with its age, and nothing
--    else. Deliberately narrow, in the same spirit as rider_directory.
-- -----------------------------------------------------------------------------

create or replace view public.order_rider_position
with (security_invoker = false)
as
select
  o.id                                                                       as order_id,
  rp.rider_id,
  rp.lat,
  rp.lng,
  rp.recorded_at,
  -- Age is computed on the SERVER. If the phone computed it, a phone whose clock
  -- is ten minutes fast would show every position as "updated 10 min ago" — or,
  -- worse, a phone ten minutes slow would show a stale dot as "just now".
  greatest(0, floor(extract(epoch from (now() - rp.recorded_at))))::integer   as age_seconds,
  -- Distance and ETA exist only once the destination has coordinates. Until the
  -- address screen captures them, both are NULL and the app shows position and
  -- age alone — never an ETA invented from nothing.
  case
    when a.lat is not null and a.lng is not null
      then round(public.metres_between(rp.lat, rp.lng, a.lat, a.lng)::numeric, 1)::double precision
  end                                                                        as distance_m,
  case
    when a.lat is not null and a.lng is not null
      then public.eta_minutes_for(public.metres_between(rp.lat, rp.lng, a.lat, a.lng))
  end                                                                        as eta_minutes
from public.orders o
join public.rider_positions rp
  on rp.order_id = o.id
 and rp.rider_id = o.assigned_to
left join public.addresses a
  on a.id = o.address_id
where o.status = 'out_for_delivery'
  -- A stale row is not returned at all, rather than returned with a scary age.
  -- The app must fall back to the status ladder and the call button; a greyed
  -- dot is still a dot a customer will walk out to the road for.
  and rp.recorded_at > now() - interval '10 minutes'
  -- A 500 m accuracy circle is not "where he is".
  and (rp.accuracy_m is null or rp.accuracy_m <= 150)
  -- The customer of this order, or the shop owner. NOT another rider
  -- (is_staff() includes delivery, so it is deliberately not used here), and
  -- not any other customer.
  and (o.user_id = auth.uid() or public.is_admin());

comment on view public.order_rider_position is
  'The assigned rider''s current position for a customer''s own out-for-delivery '
  'order, with server-computed age and (when the address has coordinates) '
  'distance and ETA. Returns no row when the fix is older than 10 minutes, '
  'worse than 150 m accuracy, or the order is no longer out for delivery.';

revoke all on public.order_rider_position from public, anon;
grant select on public.order_rider_position to authenticated;

-- -----------------------------------------------------------------------------
-- 6. `picked_up_at` — the honest "has he got the bag" fact.
-- -----------------------------------------------------------------------------

alter table public.orders
  add column if not exists picked_up_at timestamptz;

comment on column public.orders.picked_up_at is
  'When the rider took the bag from the shop. Distinct from out_for_delivery, '
  'which can be set at assignment while the bag is still being packed. Set '
  'once, by the assigned rider, and never cleared.';

-- A separate trigger rather than a rewrite of guard_order_update(): that
-- function is two hundred lines of allowlist logic and re-creating it to add one
-- column is how a guard silently loses a rule. This trigger owns exactly one
-- column and touches nothing else.
create or replace function public.guard_picked_up_at()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Nothing to check. This includes the account-erasure UPDATE, which does not
  -- touch picked_up_at, so erasure keeps working without a special case.
  if new.picked_up_at is not distinct from old.picked_up_at then
    return new;
  end if;

  -- The shop owner may correct a mistake.
  if public.is_admin() then
    return new;
  end if;

  if public.current_user_role() is distinct from 'delivery' then
    raise exception 'Only the assigned rider can record a pickup.'
      using errcode = '42501';
  end if;

  if old.assigned_to is distinct from auth.uid() then
    raise exception 'This order is not assigned to you.'
      using errcode = '42501';
  end if;

  -- A pickup is a moment, not a field. Once written it is a fact about the past.
  if old.picked_up_at is not null then
    raise exception 'The pickup time is already recorded.'
      using errcode = '42501';
  end if;
  if new.picked_up_at is null then
    raise exception 'A pickup time cannot be cleared.'
      using errcode = '42501';
  end if;

  -- The bag has to exist before it can be carried. `confirmed` and `packing` are
  -- both acceptable: a small shop finishes packing while the rider is already
  -- standing at the counter.
  if old.status not in ('confirmed', 'packing', 'out_for_delivery') then
    raise exception 'A bag cannot be picked up from a % order.', old.status
      using errcode = '42501';
  end if;

  -- Tolerate a couple of minutes of clock skew, refuse a timestamp from the
  -- future: a pickup that has not happened yet would make the tracker lie in the
  -- opposite direction.
  if new.picked_up_at > now() + interval '5 minutes' then
    raise exception 'A pickup time cannot be in the future.'
      using errcode = '22023';
  end if;

  return new;
end;
$$;

comment on function public.guard_picked_up_at() is
  'Owns orders.picked_up_at: once, by the assigned rider, only from a state '
  'where the bag can physically exist, and never cleared.';

drop trigger if exists orders_guard_picked_up_at on public.orders;
create trigger orders_guard_picked_up_at
  before update on public.orders
  for each row execute function public.guard_picked_up_at();

-- -----------------------------------------------------------------------------
-- 7. When the delivery ends, the position is deleted.
-- -----------------------------------------------------------------------------
-- This is what makes "no delivery, no stored position" true even for a rider who
-- closed the app with a stale fix still on file. It also means the table stays
-- small: it holds at most one row per rider, only for riders actually working.
-- -----------------------------------------------------------------------------

create or replace function public.clear_rider_position_on_close()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status = 'out_for_delivery'
     and new.status is distinct from 'out_for_delivery' then
    delete from public.rider_positions where order_id = new.id;
  end if;
  return null;
end;
$$;

comment on function public.clear_rider_position_on_close() is
  'Deletes the stored position as soon as its order leaves out_for_delivery, so '
  'a position can never outlive the delivery it was recorded for.';

drop trigger if exists orders_clear_rider_position on public.orders;
create trigger orders_clear_rider_position
  after update of status on public.orders
  for each row execute function public.clear_rider_position_on_close();

-- -----------------------------------------------------------------------------
-- 8. The pickup timestamp is part of the tracker the customer reads.
-- -----------------------------------------------------------------------------
-- `order_items` and the order row already carry everything else the screen
-- needs; this column is read straight off `orders`, so no view change is
-- required. Recorded here so the next reader knows it was considered.
