-- =============================================================================
-- Door pin: the address carries coordinates, and the order snapshots them.
--
-- WHY THIS FILE EXISTS
-- -------------------
-- The tracking map (`components/rider-map.tsx`) draws two things: the rider's
-- live fix and the door. The rider half has been live since
-- 20261026000001. The door half could not be, because nothing anywhere in the
-- system writes a coordinate for a delivery address — `addresses.lat/lng` have
-- existed since that same migration, but no screen fills them, so
-- `order_rider_position` has always returned `distance_m = NULL,
-- eta_minutes = NULL` and the map has always drawn the rider alone with no
-- route line. Every "how far is he" number in the app has been silently absent.
--
-- Two small changes fix that, and neither of them is new storage:
--
--   1. `public.is_usable_fix(lat, lng)` — one definition of "a coordinate that
--      is a place", shared by the write path and the read path, in SQL.
--   2. `place_order()` is re-created (never edited — migrations are append-only)
--      to copy `lat`/`lng` into the `delivery_address` snapshot when the saved
--      address has a usable pair.
--
-- WHY THE SNAPSHOT, AND NOT A JOIN
-- --------------------------------
-- `order_rider_position` reads `addresses` through `orders.address_id` for the
-- ETA, which is correct while an order is live. But the rider's screen and the
-- customer's order screen read the **snapshot**, and a snapshot is what stops a
-- customer who moves house next year from rewriting where their 2026 order
-- went. If the door pin only ever lived in `addresses`, the map on a past order
-- would silently point at wherever that person lives now.
--
-- The rule is therefore: the snapshot carries the pin, the copy is a copy, and
-- editing an address afterwards changes nothing about any order already placed.
--
-- WHAT THIS DELIBERATELY DOES NOT DO
-- ----------------------------------
-- It does not try to *invent* a coordinate. There is no reverse geocoding here
-- and no shop-coordinate table to sanity-check a pin against (`stores` has no
-- lat/lng). A pin is the customer's own claim about their own door, written by
-- them, on their own address — the same trust model as the landmark text the
-- rider has always read alongside it. What the database guarantees is only that
-- a pin is *a place at all*: inside the earth's bounds, and not (0,0), which is
-- what a failed GPS reports and would draw the rider's dot in the Gulf of
-- Guinea.
--
-- `place_order()` below is a byte-for-byte copy of the CURRENT version — the
-- 6-argument one in 20261014000004_coupons.sql as amended by
-- 20261021000003_product_guard.sql, NOT the 5-argument original in
-- 20261002000008. Copying the old one would have silently dropped coupon
-- support; getting the signature wrong leaves TWO overloads and every RPC call
-- becomes ambiguous, which is a bug the app only sees at runtime. The single
-- change is in step 12.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. One definition of "a coordinate that is a place".
--
--    Immutable and pure so it can be called from a CHECK, a view or a function
--    without any planner surprise. The null island test is not pedantry:
--    `isValidLatLng` in `apps/mobile/src/lib/map-tiles.ts` refuses the same
--    pair for the same reason, and `rider_positions` refuses it with a CHECK.
--    Three places, one rule.
-- -----------------------------------------------------------------------------

create or replace function public.is_usable_fix(p_lat double precision, p_lng double precision)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_lat is not null
     and p_lng is not null
     and p_lat between -90 and 90
     and p_lng between -180 and 180
     -- (0, 0) is what a device reports when it has no idea where it is. A door
     -- drawn in the Atlantic is worse than no door at all.
     and not (p_lat = 0 and p_lng = 0);
$$;

comment on function public.is_usable_fix(double precision, double precision) is
  'True when a latitude/longitude pair is a place: both present, inside the '
  'earth''s bounds, and not the null island (0,0), which is what a failed fix '
  'reports. Shared by the address write path and the order snapshot.';

-- Grants on a plain helper: it leaks nothing (it takes no auth.uid(), reads no
-- table), so any signed-in caller may ask it. Anon is refused like everything
-- else here.
revoke all on function public.is_usable_fix(double precision, double precision)
  from public, anon;
grant execute on function public.is_usable_fix(double precision, double precision)
  to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 2. place_order() re-created with the door pin in the snapshot.
--
--    The keys are ABSENT, not null, when there is no pin. `jsonb_build_object`
--    happily stores `"lat": null`, and the app would then have to distinguish
--    "no pin" from "a pin of null". Not writing the key at all makes the absence
--    the answer, and the test asserts it.
-- -----------------------------------------------------------------------------

create or replace function public.place_order(
  p_items            jsonb,
  p_store_id         uuid,
  p_address_id       uuid,
  p_idempotency_key  text,
  p_note             text default null,
  p_coupon_code      text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid         uuid := auth.uid();
  v_existing    public.orders%rowtype;
  v_address     public.addresses%rowtype;
  v_store       public.stores%rowtype;
  v_settings    public.store_settings%rowtype;
  v_zone        public.delivery_zones%rowtype;
  v_product     public.products%rowtype;
  v_coupon      public.coupons%rowtype;
  v_item        jsonb;
  v_order_id    uuid;
  v_order_number text;
  v_snapshot    jsonb;
  v_subtotal    bigint := 0;
  v_delivery_fee bigint := 0;
  v_discount    bigint := 0;
  v_total       bigint := 0;
  v_free_above  bigint;
  v_qty         integer;
  v_local_time  time;
  v_coupon_code text;
  v_now         timestamptz := now();
  v_problems    jsonb := '[]'::jsonb;
begin
  -- 1. Who is calling?
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'not_logged_in');
  end if;

  if p_idempotency_key is null or length(trim(p_idempotency_key)) < 8 then
    return jsonb_build_object('ok', false, 'error', 'invalid_idempotency_key');
  end if;

  -- 2. Has this exact request already been placed? Return the same order.
  select * into v_existing
  from public.orders o
  where o.user_id = v_uid and o.idempotency_key = p_idempotency_key;

  if found then
    return jsonb_build_object(
      'ok', true,
      'order_id', v_existing.id,
      'order_number', v_existing.order_number,
      'total_paise', v_existing.total_paise,
      'discount_paise', v_existing.discount_paise,
      'coupon_code', v_existing.coupon_code,
      'replayed', true
    );
  end if;

  -- 3. Shape of the cart. Bad input never reaches the database.
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    return jsonb_build_object('ok', false, 'error', 'invalid_items');
  end if;

  if jsonb_array_length(p_items) = 0 then
    return jsonb_build_object('ok', false, 'error', 'empty_cart');
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_items) as e(item)
    where coalesce(e.item ->> 'product_id', '')
            !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       or jsonb_typeof(e.item -> 'quantity') <> 'number'
       or (e.item ->> 'quantity') !~ '^[0-9]+$'
       or (e.item ->> 'quantity')::integer < 1
       or (e.item ->> 'quantity')::integer > 99
  ) then
    return jsonb_build_object('ok', false, 'error', 'invalid_items');
  end if;

  -- 4. The address must belong to the person placing the order.
  select * into v_address
  from public.addresses a
  where a.id = p_address_id and a.user_id = v_uid;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'address_not_found');
  end if;

  -- 5. The shop.
  select * into v_store from public.stores s where s.id = p_store_id;

  if not found or not v_store.is_active then
    return jsonb_build_object('ok', false, 'error', 'store_not_found');
  end if;

  select * into v_settings from public.store_settings ss where ss.store_id = p_store_id;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'store_not_found');
  end if;

  -- 6. Does this shop deliver to that pincode?
  select * into v_zone
  from public.delivery_zones z
  where z.store_id = p_store_id and z.pincode = v_address.pincode;

  if not found or not v_zone.is_active then
    return jsonb_build_object('ok', false, 'error', 'zone_not_served');
  end if;

  -- 7. Is the shop open? (IST, so a customer abroad is judged by Kunigal's clock.)
  if not v_settings.is_open then
    return jsonb_build_object('ok', false, 'error', 'store_closed');
  end if;

  v_local_time := (v_now at time zone v_settings.timezone)::time;

  if v_settings.open_time is not null and v_settings.close_time is not null then
    if v_settings.open_time < v_settings.close_time then
      if v_local_time < v_settings.open_time or v_local_time >= v_settings.close_time then
        return jsonb_build_object('ok', false, 'error', 'store_closed');
      end if;
    else
      if v_local_time < v_settings.open_time and v_local_time >= v_settings.close_time then
        return jsonb_build_object('ok', false, 'error', 'store_closed');
      end if;
    end if;
  end if;

  -- 8. Lock the product rows and price them FROM THE DATABASE.
  for v_item in
    select e.item
    from jsonb_array_elements(p_items) as e(item)
    order by (e.item ->> 'product_id')
  loop
    select * into v_product
    from public.products pr
    where pr.id = (v_item ->> 'product_id')::uuid and pr.store_id = p_store_id
    for update;

    if not found then
      v_problems := v_problems || jsonb_build_array(jsonb_build_object(
        'product_id', (v_item ->> 'product_id')::uuid,
        'reason', 'unavailable'
      ));
      continue;
    end if;

    if not v_product.is_active then
      v_problems := v_problems || jsonb_build_array(jsonb_build_object(
        'product_id', v_product.id,
        'name_en', v_product.name_en,
        'name_kn', v_product.name_kn,
        'unit', v_product.unit,
        'requested', (v_item ->> 'quantity')::integer,
        'available', 0,
        'reason', 'unavailable'
      ));
      continue;
    end if;

    v_qty := (v_item ->> 'quantity')::integer;

    if v_product.stock_qty < v_qty then
      v_problems := v_problems || jsonb_build_array(jsonb_build_object(
        'product_id', v_product.id,
        'name_en', v_product.name_en,
        'name_kn', v_product.name_kn,
        'unit', v_product.unit,
        'requested', v_qty,
        'available', v_product.stock_qty,
        'reason', 'insufficient_stock'
      ));
      continue;
    end if;

    v_subtotal := v_subtotal + (v_product.price_paise::bigint * v_qty);
  end loop;

  -- 9. All or nothing.
  if jsonb_array_length(v_problems) > 0 then
    return jsonb_build_object(
      'ok', false,
      'error', 'items_unavailable',
      'items', v_problems
    );
  end if;

  -- 10. Smallest basket the shop accepts.
  if v_subtotal < v_settings.min_order_value_paise then
    return jsonb_build_object(
      'ok', false,
      'error', 'below_minimum',
      'min_order_value_paise', v_settings.min_order_value_paise,
      'subtotal_paise', v_subtotal
    );
  end if;

  -- 11. Delivery fee: this pincode's fee, else the shop default; free above the
  --     free-delivery threshold.
  v_free_above := v_settings.free_delivery_above_paise;
  v_delivery_fee := coalesce(v_zone.delivery_fee_paise, v_settings.delivery_fee_paise);

  if v_free_above is not null and v_subtotal >= v_free_above then
    v_delivery_fee := 0;
  end if;

  -- 11b. Coupon. Re-checked here from the locked row, exactly like the preview,
  --      so the app cannot talk the database into a discount.
  v_coupon_code := upper(trim(coalesce(p_coupon_code, '')));

  if v_coupon_code <> '' then
    select * into v_coupon
    from public.coupons c
    where c.store_id = p_store_id and c.code = v_coupon_code
    for update;

    if not found then
      return jsonb_build_object('ok', false, 'error', 'coupon_not_found');
    end if;

    if not v_coupon.is_active then
      return jsonb_build_object('ok', false, 'error', 'coupon_inactive');
    end if;

    if v_coupon.starts_at is not null and v_now < v_coupon.starts_at then
      return jsonb_build_object('ok', false, 'error', 'coupon_not_started');
    end if;

    if v_coupon.ends_at is not null and v_now > v_coupon.ends_at then
      return jsonb_build_object('ok', false, 'error', 'coupon_expired');
    end if;

    if v_coupon.usage_limit is not null and v_coupon.used_count >= v_coupon.usage_limit then
      return jsonb_build_object('ok', false, 'error', 'coupon_used_up');
    end if;

    if v_subtotal < v_coupon.min_order_paise then
      return jsonb_build_object(
        'ok', false,
        'error', 'coupon_min_order',
        'min_order_paise', v_coupon.min_order_paise,
        'subtotal_paise', v_subtotal
      );
    end if;

    v_discount := public.coupon_discount(v_coupon, v_subtotal::integer);
  end if;

  v_total := v_subtotal + v_delivery_fee - v_discount;

  -- 12. The order itself. Cash on Delivery only.
  --
  --     THE ONE CHANGE THIS FILE MAKES: the snapshot is built first, then the
  --     pin is added if the saved address has a usable pair, so the keys are
  --     absent rather than null when there is none. `orders_guard_insert` sees
  --     the same row shape it always did: two extra jsonb keys on a column the
  --     app never writes directly.
  v_snapshot := jsonb_build_object(
    'label', v_address.label,
    'full_name', v_address.full_name,
    'phone', v_address.phone,
    'line1', v_address.line1,
    'line2', v_address.line2,
    'landmark', v_address.landmark,
    'city', v_address.city,
    'state', v_address.state,
    'pincode', v_address.pincode
  );

  if public.is_usable_fix(v_address.lat, v_address.lng) then
    v_snapshot := v_snapshot || jsonb_build_object(
      'lat', v_address.lat,
      'lng', v_address.lng
    );
  end if;

  insert into public.orders (
    user_id, store_id, address_id, delivery_address,
    payment_method, payment_status,
    subtotal_paise, delivery_fee_paise, discount_paise, total_paise,
    notes, idempotency_key, coupon_code
  )
  values (
    v_uid, p_store_id, p_address_id, v_snapshot,
    'cod', 'pending',
    v_subtotal, v_delivery_fee, v_discount, v_total,
    nullif(trim(p_note), ''),
    p_idempotency_key,
    nullif(v_coupon_code, '')
  )
  returning id, order_number into v_order_id, v_order_number;

  -- Count the use only now, with the order really written.
  if v_coupon_code <> '' then
    update public.coupons set used_count = used_count + 1 where id = v_coupon.id;
  end if;

  -- 13. Line items and the stock decrement, same transaction.
  --
  -- The stock move below is the ONE thing a non-admin may do to `products`.
  -- The flag is transaction-local, and the guard also checks the shape: only
  -- `stock_qty` may differ while it is set, so it cannot be borrowed to reprice
  -- the shelf.
  perform set_config('kunigal.moving_stock', 'on', true);

  for v_item in
    select e.item
    from jsonb_array_elements(p_items) as e(item)
    order by (e.item ->> 'product_id')
  loop
    v_qty := (v_item ->> 'quantity')::integer;

    select * into v_product
    from public.products pr
    where pr.id = (v_item ->> 'product_id')::uuid
    for update;

    insert into public.order_items (
      order_id, product_id, product_name_en, product_name_kn,
      unit, image_url, price_paise, quantity
    )
    values (
      v_order_id, v_product.id, v_product.name_en, v_product.name_kn,
      v_product.unit, v_product.image_url, v_product.price_paise, v_qty
    );

    update public.products
    set stock_qty = stock_qty - v_qty
    where id = v_product.id;
  end loop;

  perform set_config('kunigal.moving_stock', 'off', true);

  return jsonb_build_object(
    'ok', true,
    'order_id', v_order_id,
    'order_number', v_order_number,
    'subtotal_paise', v_subtotal,
    'delivery_fee_paise', v_delivery_fee,
    'discount_paise', v_discount,
    'coupon_code', nullif(v_coupon_code, ''),
    'total_paise', v_total,
    'replayed', false
  );
end;
$$;

comment on function public.place_order(jsonb, uuid, uuid, text, text, text) is
  'Places a Cash-on-Delivery order. All prices come from the database. All or '
  'nothing. The delivery address is snapshotted, including the door pin when '
  'the saved address has usable coordinates.';

-- Grants. `create or replace` keeps them, but a function this central is worth
-- being explicit about: authenticated may place, and nobody else may.
revoke execute on function public.place_order(jsonb, uuid, uuid, text, text, text) from public, anon;
grant execute on function public.place_order(jsonb, uuid, uuid, text, text, text) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 3. Document the snapshot's new keys.
--
--    A comment, not a constraint: jsonb is jsonb, and a CHECK on this column
--    would have to be written in a way that still accepts every historical row
--    (which has no keys at all). The test file is the enforcement.
-- -----------------------------------------------------------------------------

comment on column public.orders.delivery_address is
  'Snapshot of the delivery address at the moment the order was placed: label, '
  'full_name, phone, line1, line2, landmark, city, state, pincode, and — when '
  'the saved address carried usable coordinates — lat and lng. The keys are '
  'ABSENT, never null, when there is no pin. Editing the address afterwards '
  'changes nothing here; a snapshot is what keeps a past order pointing at the '
  'house it was actually delivered to.';

-- -----------------------------------------------------------------------------
-- 4. `order_rider_position` measures to the door THIS ORDER was sent to.
--
--    Replacing the view rather than editing 20261026000001 (migrations are
--    append-only). Column names, order and types are unchanged, so the app and
--    test 24 see exactly what they saw before.
--
--    The only change is where the destination comes from. It used to read
--    `addresses` alone, which was wrong in one direction each way:
--
--      * a customer who moves their saved pin after ordering would have the
--        ETA measured to their NEW door while the map on the same order drew
--        the OLD one — two answers on one screen;
--      * a customer who saved their address before this feature existed (every
--        customer) and later dropped a pin would keep getting NULL distance and
--        a NULL ETA forever, even though the address now has a pin.
--
--    So the snapshot wins when it carries a usable pin, and the live address is
--    the fallback. Neither is invented: if there is no pin anywhere, the
--    columns stay NULL and the app says nothing rather than guessing.
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
    when d.lat is not null and d.lng is not null
      then round(public.metres_between(rp.lat, rp.lng, d.lat, d.lng)::numeric, 1)::double precision
  end                                                                        as distance_m,
  case
    when d.lat is not null and d.lng is not null
      then public.eta_minutes_for(public.metres_between(rp.lat, rp.lng, d.lat, d.lng))
  end                                                                        as eta_minutes
from public.orders o
join public.rider_positions rp
  on rp.order_id = o.id
 and rp.rider_id = o.assigned_to
left join public.addresses a
  on a.id = o.address_id
-- The door this order is actually being sent to: the snapshot's pin when it has
-- one, else the saved address's pin, else nothing at all.
cross join lateral (
  select
    case
      when public.is_usable_fix(
             (o.delivery_address ->> 'lat')::double precision,
             (o.delivery_address ->> 'lng')::double precision)
        then (o.delivery_address ->> 'lat')::double precision
      else a.lat
    end as lat,
    case
      when public.is_usable_fix(
             (o.delivery_address ->> 'lat')::double precision,
             (o.delivery_address ->> 'lng')::double precision)
        then (o.delivery_address ->> 'lng')::double precision
      else a.lng
    end as lng
) d
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
  'order, with server-computed age and (when the order''s door has coordinates — '
  'its own snapshot first, the saved address second) distance and ETA. Returns '
  'no row when the fix is older than 10 minutes, worse than 150 m accuracy, or '
  'the order is no longer out for delivery.';
