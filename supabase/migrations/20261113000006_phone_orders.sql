-- =============================================================================
-- 20261113000006 · Phone orders, on the same pricing and stock core
-- =============================================================================
-- Owner directive (2026-11-13): "build phone-order entry reusing the
-- `place_order` pricing/stock core (no duplicate logic); nullable `user_id`
-- plus contact name/phone plus a `source` column; show the 4-digit handover
-- code on the owner screen for phone orders so the owner can read it out;
-- owner override of the delivery radius needs a recorded reason."
--
-- THE PROBLEM WITH A SECOND `place_order`
-- ---------------------------------------
-- The shop already takes orders by phone. Until now the only honest way to
-- enter one was to walk through the customer app as the customer, which is
-- impossible: the caller is not a user, has no `addresses` row and no auth
-- session. A copy of `place_order` for the counter would be a second place
-- where the price is read, the stock is decremented, the coupon is checked,
-- the fee is chosen and the total is computed. The two copies would agree on
-- the day they were written and disagree the first time either was fixed -
-- and the disagreement would be money.
--
-- So the arithmetic moves into ONE internal function, `place_order_core()`,
-- and the two public doors are thin:
--
--   place_order(...)               - the customer app. Same 8 arguments and
--                                    the same return shape as before, so the
--                                    app is untouched. It authenticates, then
--                                    calls the core as `source = 'app'`.
--   admin_place_phone_order(...)   - the counter. It proves `is_admin()`,
--                                    normalises the typed contact and address,
--                                    then calls the SAME core as
--                                    `source = 'phone'`.
--
-- `place_order_core()` is executable by nobody: public, anon, authenticated
-- and service_role are all revoked. The definer wrappers still run it because
-- they execute as its owner. A client cannot reach it through PostgREST, so
-- there is no second, unguarded door into the money.
--
-- WHAT A PHONE ORDER IS
-- ---------------------
--   * `orders.user_id` becomes nullable. A phone caller has no profile.
--   * `source` is `'app'` or `'phone'`. Every existing row is an app order.
--   * `contact_name` / `contact_phone` are required for a phone order and
--     absent for an app order (the app already snapshots the address's own
--     name and phone into `delivery_address`).
--   * `address_id` is NULL for a phone order: the owner types the door, and
--     the typed fields are snapshotted into `delivery_address` exactly like a
--     saved address would be. History never depends on a row that does not
--     exist.
--   * Idempotency: the existing unique index is `(user_id, idempotency_key)`,
--     and NULL user_id is not protected by it. A partial unique index on
--     `idempotency_key where source = 'phone'` makes a double tap at the
--     counter return the first order instead of writing a second.
--
-- THE DOOR-PIN GATE AND THE RADIUS
-- --------------------------------
-- A phone caller has no door pin, so the core's pin gate is asked not to
-- apply (`p_enforce_door_pin = false`): the owner is on the phone with the
-- person and can ask for a landmark, and refusing every phone order for the
-- lack of a pin would make the feature useless. The app still passes true.
--
-- With no pin, the core's pincode rule decides the delivery area, exactly as
-- it does for a pinless app address. When the pincode is not served, or when
-- both pins exist and the measured distance is beyond `delivery_radius_m`,
-- the owner may accept the order anyway - but ONLY through the phone door,
-- ONLY with a reason of at least 3 characters, and the reason is stored on
-- the order (`radius_override_reason`). An override with no sentence is a
-- rule quietly deleted; the stored reason is what makes it a decision.
--
-- Express is not offered on a phone order (`p_express = false`): its whole
-- promise is a measured distance, and a typed address has no measurement.
--
-- THE ONE MEASUREMENT THE COUNTER CAN HAVE
-- ----------------------------------------
-- If the customer dropped a location ("I'm behind the bus stand") the owner can
-- attach it, and the SAME distance rule then runs: inside the radius it is an
-- ordinary order; beyond it the owner overrides with a stored reason. The
-- coordinate is judged by `is_usable_fix()` exactly as a door pin is, and it is
-- written into the snapshot only when it is a place, so a rider is never sent
-- to the wrong district. When the owner has no coordinate the pincode rule
-- decides, unchanged, and an unserved pincode is the other door the override
-- opens.
-- -----------------------------------------------------------------------------
-- 1. The shape of a phone order.
-- -----------------------------------------------------------------------------

alter table public.orders
  alter column user_id drop not null;

alter table public.orders
  add column if not exists source text not null default 'app',
  add column if not exists contact_name text,
  add column if not exists contact_phone text,
  add column if not exists radius_override_reason text;

alter table public.orders
  drop constraint if exists orders_source_valid,
  add constraint orders_source_valid
    check (source in ('app', 'phone'));

-- A phone order must carry a reachable person. The number is stored as the
-- ten local digits (the wrapper normalises `+91` and spaces away), and a
-- landline is refused because a delivery needs a mobile.
alter table public.orders
  drop constraint if exists orders_phone_contact_required,
  add constraint orders_phone_contact_required
    check (
      source <> 'phone'
      or (
        contact_name is not null
        and length(btrim(contact_name)) >= 2
        and contact_phone ~ '^[6-9][0-9]{9}$'
      )
    );

-- An override without a reason is a rule quietly deleted.
alter table public.orders
  drop constraint if exists orders_radius_override_reason_len,
  add constraint orders_radius_override_reason_len
    check (
      radius_override_reason is null
      or length(btrim(radius_override_reason)) >= 3
    );

-- A phone order has no user_id, so `orders_user_idempotency_key_idx` cannot
-- protect it (NULLs are distinct in a unique index). This is the counter's
-- double-tap guard. App orders keep the existing index unchanged.
create unique index if not exists orders_phone_idempotency_key_idx
  on public.orders (idempotency_key)
  where source = 'phone' and idempotency_key is not null;

-- The owner looks a caller up by the number they rang from; the coupon
-- per-customer check for phone orders counts by the same column.
create index if not exists orders_contact_phone_idx
  on public.orders (contact_phone)
  where contact_phone is not null;

comment on column public.orders.source is
  'How the order reached the shop: ''app'' (the customer placed it) or '
  '''phone'' (the owner entered it from the counter). Every pre-2026-11-13 '
  'row is ''app''.';

comment on column public.orders.contact_name is
  'For a phone order only: the person to ask for at the door. NULL on app '
  'orders, whose delivery_address snapshot already carries the name.';

comment on column public.orders.contact_phone is
  'For a phone order only: the ten local digits to ring at the door. NULL on '
  'app orders.';

comment on column public.orders.radius_override_reason is
  'Why the shop accepted a phone order outside its delivery area. NULL when '
  'no override was needed. At least 3 characters when present: an override '
  'without a reason is a rule quietly deleted.';

comment on column public.orders.user_id is
  'The customer profile for an app order. NULL for a phone order: the caller '
  'has no account. RLS still hides a NULL-user order from every customer and '
  'shows it to staff and riders.';

-- -----------------------------------------------------------------------------
-- 2. The one pricing and stock engine.
--
-- SECURITY DEFINER because it writes orders, items and stock as the owner of
-- the schema. It is NOT granted to any client role: the two wrappers below
-- are the only callers. `p_source` and `p_user_id` are decided by the wrapper,
-- never by the app, so a customer cannot claim to be a phone order.
-- -----------------------------------------------------------------------------

create or replace function public.place_order_core(
  p_items               jsonb,
  p_store_id            uuid,
  p_address_id          uuid,
  p_delivery_address    jsonb,
  p_idempotency_key     text,
  p_note                text,
  p_coupon_code         text,
  p_payment_method      public.payment_method,
  p_express             boolean,
  p_user_id             uuid,
  p_source              text,
  p_contact_name        text,
  p_contact_phone       text,
  p_enforce_door_pin    boolean,
  p_can_override_radius boolean,
  p_override_reason     text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing      public.orders%rowtype;
  v_address       public.addresses%rowtype;
  v_store         public.stores%rowtype;
  v_settings      public.store_settings%rowtype;
  v_zone          public.delivery_zones%rowtype;
  v_product       public.products%rowtype;
  v_coupon        public.coupons%rowtype;
  v_item          jsonb;
  v_order_id      uuid;
  v_order_number  text;
  v_snapshot      jsonb;
  v_subtotal      bigint := 0;
  v_delivery_fee  bigint := 0;
  v_discount      bigint := 0;
  v_total         bigint := 0;
  v_free_above    bigint;
  v_qty           integer;
  v_units         bigint := 0;
  v_distance      double precision;
  v_lat           double precision;
  v_lng           double precision;
  v_has_fix       boolean;
  v_express_fee   bigint := 0;
  v_eta           integer;
  v_local_time    time;
  v_coupon_code   text;
  v_now           timestamptz := now();
  v_problems      jsonb := '[]'::jsonb;
  v_used          bigint;
  v_pincode       text;
  v_override      boolean := false;
  v_reason        text := nullif(btrim(coalesce(p_override_reason, '')), '');
begin
  -- 1. The wrapper decides who is calling. These are defensive: no client
  --    role can execute this function at all.
  if p_source is null or p_source not in ('app', 'phone') then
    return jsonb_build_object('ok', false, 'error', 'invalid_source');
  end if;

  if p_source = 'app' and p_user_id is null then
    return jsonb_build_object('ok', false, 'error', 'not_logged_in');
  end if;

  if p_source = 'phone'
     and (
       p_contact_name is null
       or length(btrim(p_contact_name)) < 2
       or p_contact_phone is null
       or p_contact_phone !~ '^[6-9][0-9]{9}$'
     ) then
    return jsonb_build_object('ok', false, 'error', 'invalid_contact');
  end if;

  if p_idempotency_key is null or length(trim(p_idempotency_key)) < 8 then
    return jsonb_build_object('ok', false, 'error', 'invalid_idempotency_key');
  end if;

  -- 2. Has this exact request already been placed? Return the same order.
  --    App: the same customer and key (the existing unique index). Phone:
  --    the same key on a phone order (the partial unique index).
  select * into v_existing
    from public.orders o
   where o.idempotency_key = p_idempotency_key
     and o.source = p_source
     and (p_source = 'phone' or o.user_id = p_user_id);

  if found then
    return jsonb_build_object(
      'ok', true,
      'order_id', v_existing.id,
      'order_number', v_existing.order_number,
      'total_paise', v_existing.total_paise,
      'discount_paise', v_existing.discount_paise,
      'coupon_code', v_existing.coupon_code,
      'payment_method', v_existing.payment_method,
      'is_express', v_existing.is_express,
      'source', v_existing.source,
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

  -- 4. The address.
  --
  --    App: a saved row, and it must belong to the caller (judged after the
  --    replay above, exactly as before - a retry still answers with the order
  --    even if the address was deleted a second later).
  --    Phone: no row exists; the wrapper's validated jsonb IS the snapshot.
  if p_address_id is not null then
    select * into v_address
      from public.addresses a
     where a.id = p_address_id;

    if not found then
      return jsonb_build_object('ok', false, 'error', 'address_not_found');
    end if;

    if p_source = 'app' and v_address.user_id is distinct from p_user_id then
      return jsonb_build_object('ok', false, 'error', 'address_not_found');
    end if;

    v_pincode := v_address.pincode;
    v_lat := v_address.lat;
    v_lng := v_address.lng;
  else
    if p_delivery_address is null
       or jsonb_typeof(p_delivery_address) <> 'object' then
      return jsonb_build_object('ok', false, 'error', 'address_not_found');
    end if;

    v_pincode := nullif(btrim(coalesce(p_delivery_address ->> 'pincode', '')), '');

    -- The owner may have attached the door the customer dropped them. It is
    -- judged exactly as a door pin is, and ignored when it is not a place.
    if nullif(coalesce(p_delivery_address ->> 'lat', ''), '') is not null
       and nullif(coalesce(p_delivery_address ->> 'lng', ''), '') is not null then
      v_lat := (p_delivery_address ->> 'lat')::double precision;
      v_lng := (p_delivery_address ->> 'lng')::double precision;
    end if;

    if not public.is_usable_fix(v_lat, v_lng) then
      v_lat := null;
      v_lng := null;
    end if;
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

  -- 6. Can the shop reach that door?
  --
  -- 6a. The pilot gate. Only the app asks for it: the shop demands a door pin
  --     and has a usable pin of its own, so a pinless address is not a
  --     delivery yet. A phone order deliberately skips it - the owner is on
  --     the phone and has a typed door instead.
  if p_enforce_door_pin
     and v_settings.address_pin_required
     and public.is_usable_fix(v_store.lat, v_store.lng)
     and not public.is_usable_fix(v_address.lat, v_address.lng) then
    return jsonb_build_object('ok', false, 'error', 'address_pin_required');
  end if;

  -- 6b. The pin decides when both pins exist. An app order reads its address's
  --     pin; a phone order uses the coordinate the owner attached, if any. With
  --     no pin on either side the pincode rule decides, exactly as before.
  v_has_fix := public.is_usable_fix(v_store.lat, v_store.lng)
           and public.is_usable_fix(v_lat, v_lng);

  v_zone := null;

  if v_has_fix then
    v_distance := public.distance_metres(v_store.lat, v_store.lng, v_lat, v_lng);

    if v_distance > v_settings.delivery_radius_m then
      if not p_can_override_radius then
        return jsonb_build_object(
          'ok', false,
          'error', 'outside_delivery_radius',
          'distance_m', round(v_distance)::integer,
          'radius_m', v_settings.delivery_radius_m
        );
      end if;

      if v_reason is null or length(v_reason) < 3 then
        return jsonb_build_object('ok', false, 'error', 'override_reason_required');
      end if;

      v_override := true;
    end if;

    -- Inside the radius, or accepted by the owner. The pincode row is now
    -- only a fee/ETA override.
    select * into v_zone
      from public.delivery_zones z
     where z.store_id = p_store_id
       and z.pincode = v_pincode
       and z.is_active;
  else
    -- No pin on one side: the old pincode rule, unchanged.
    select * into v_zone
      from public.delivery_zones z
     where z.store_id = p_store_id and z.pincode = v_pincode;

    if not found or not v_zone.is_active then
      if not p_can_override_radius then
        return jsonb_build_object('ok', false, 'error', 'zone_not_served');
      end if;

      if v_reason is null or length(v_reason) < 3 then
        return jsonb_build_object('ok', false, 'error', 'override_reason_required');
      end if;

      v_override := true;
      v_zone := null;
    end if;
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

  -- 7b. A method the shop cannot collect is not a method.
  if p_payment_method is null then
    return jsonb_build_object('ok', false, 'error', 'invalid_payment_method');
  end if;

  if p_payment_method <> 'cod' and not v_settings.online_payments_enabled then
    return jsonb_build_object('ok', false, 'error', 'online_payment_unavailable');
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
    v_units := v_units + v_qty;   -- the express basket cap
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

  -- 11a. Express. Its fee is added AFTER the free-delivery rule, because
  --      "free delivery" was never a promise to carry it in 30 minutes. The
  --      promise is checked against the same distance the radius used.
  if p_express then
    if not v_settings.express_enabled then
      return jsonb_build_object('ok', false, 'error', 'express_not_available', 'reason', 'disabled');
    end if;

    if not v_has_fix then
      return jsonb_build_object('ok', false, 'error', 'express_not_available', 'reason', 'no_location');
    end if;

    if v_distance > v_settings.express_radius_m then
      return jsonb_build_object(
        'ok', false,
        'error', 'express_not_available',
        'reason', 'too_far',
        'distance_m', round(v_distance)::integer,
        'express_radius_m', v_settings.express_radius_m
      );
    end if;

    if v_units > v_settings.express_max_units then
      return jsonb_build_object(
        'ok', false,
        'error', 'express_not_available',
        'reason', 'too_many_items',
        'units', v_units,
        'max_units', v_settings.express_max_units
      );
    end if;

    v_express_fee := v_settings.express_fee_paise;
    v_delivery_fee := v_delivery_fee + v_express_fee;
    v_eta := v_settings.express_eta_minutes;
  else
    v_eta := coalesce(v_zone.eta_minutes, 30);
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

    -- Per-customer limit (same check as validate_coupon). An app order is
    -- counted by its profile; a phone order by the number that rang, which is
    -- the only identity the counter has.
    if v_coupon.per_customer_limit is not null then
      if p_source = 'phone' then
        select count(*) into v_used
          from public.orders o
         where o.contact_phone = p_contact_phone
           and o.coupon_code = v_coupon.code
           and o.status <> 'cancelled';
      else
        select count(*) into v_used
          from public.orders o
         where o.user_id = p_user_id
           and o.coupon_code = v_coupon.code
           and o.status <> 'cancelled';
      end if;

      if v_used >= v_coupon.per_customer_limit then
        return jsonb_build_object('ok', false, 'error', 'coupon_per_customer_limit');
      end if;
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

  -- 12. The order itself.
  if p_address_id is not null then
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
  else
    -- Built and validated by the phone wrapper. Snapshotted, never a pointer.
    v_snapshot := p_delivery_address;
  end if;

  insert into public.orders (
    user_id, store_id, address_id, delivery_address,
    payment_method, payment_status,
    subtotal_paise, delivery_fee_paise, discount_paise, total_paise,
    notes, idempotency_key, coupon_code,
    is_express, eta_minutes,
    source, contact_name, contact_phone, radius_override_reason
  )
  values (
    p_user_id, p_store_id, p_address_id, v_snapshot,
    p_payment_method, 'pending',
    v_subtotal, v_delivery_fee, v_discount, v_total,
    nullif(trim(p_note), ''),
    p_idempotency_key,
    nullif(v_coupon_code, ''),
    coalesce(p_express, false), v_eta,
    p_source,
    case when p_source = 'phone' then btrim(p_contact_name) else null end,
    case when p_source = 'phone' then p_contact_phone else null end,
    case when v_override then v_reason else null end
  )
  returning id, order_number into v_order_id, v_order_number;

  -- Count the use only now, with the order really written.
  if v_coupon_code <> '' then
    update public.coupons set used_count = used_count + 1 where id = v_coupon.id;
  end if;

  -- 13. Line items and the stock decrement, same transaction.
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
    'express_fee_paise', v_express_fee,
    'discount_paise', v_discount,
    'coupon_code', nullif(v_coupon_code, ''),
    'total_paise', v_total,
    'payment_method', p_payment_method,
    'is_express', coalesce(p_express, false),
    'eta_minutes', v_eta,
    'distance_m', case when v_has_fix then round(v_distance)::integer else null end,
    'source', p_source,
    'radius_override_applied', v_override,
    'replayed', false
  );
end;
$$;

-- The core is for the two wrappers only. No client role may execute it, so
-- PostgREST has no second door into the money.
revoke all on function public.place_order_core(
  jsonb, uuid, uuid, jsonb, text, text, text, public.payment_method, boolean,
  uuid, text, text, text, boolean, boolean, text
) from public, anon, authenticated, service_role;

comment on function public.place_order_core(
  jsonb, uuid, uuid, jsonb, text, text, text, public.payment_method, boolean,
  uuid, text, text, text, boolean, boolean, text
) is
  'The one pricing, stock, coupon, fee and total engine. Internal: executable '
  'by nobody. `place_order()` (the app) and `admin_place_phone_order()` (the '
  'counter) are the only callers, and each decides the source and the user.';

-- -----------------------------------------------------------------------------
-- 3. The customer app's door: unchanged signature, unchanged answers.
-- -----------------------------------------------------------------------------

create or replace function public.place_order(
  p_items            jsonb,
  p_store_id         uuid,
  p_address_id       uuid,
  p_idempotency_key  text,
  p_note             text default null,
  p_coupon_code      text default null,
  p_payment_method   public.payment_method default 'cod',
  p_express          boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'not_logged_in');
  end if;

  -- The address ownership check lives in the core (after the replay lookup,
  -- exactly where it was) so a retry still answers with the order even if the
  -- address was deleted a second later.
  return public.place_order_core(
    p_items,
    p_store_id,
    p_address_id,
    null,
    p_idempotency_key,
    p_note,
    p_coupon_code,
    p_payment_method,
    p_express,
    v_uid,
    'app',
    null,
    null,
    true,
    false,
    null
  );
end;
$$;

comment on function public.place_order(
  jsonb, uuid, uuid, text, text, text, public.payment_method, boolean
) is
  'The customer app places an order. Authenticates, then runs the shared '
  'place_order_core() as source = ''app'' with the address-ownership check on. '
  'The signature and the return shape are unchanged by the phone-order work.';

revoke all on function public.place_order(
  jsonb, uuid, uuid, text, text, text, public.payment_method, boolean
) from public, anon;
grant execute on function public.place_order(
  jsonb, uuid, uuid, text, text, text, public.payment_method, boolean
) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 4. The counter's door.
--
-- Staff only. It normalises what a person typed and hands the SAME core a
-- ready snapshot. It never accepts a user id, a price, a total or a stock
-- number from the caller.
-- -----------------------------------------------------------------------------

create or replace function public.admin_place_phone_order(
  p_items            jsonb,
  p_store_id         uuid,
  p_idempotency_key  text,
  p_contact_name     text,
  p_contact_phone    text,
  p_address_line1    text,
  p_pincode          text,
  p_address_line2    text default null,
  p_landmark         text default null,
  p_city             text default 'Kunigal',
  p_lat              double precision default null,
  p_lng              double precision default null,
  p_note             text default null,
  p_payment_method   public.payment_method default 'cod',
  p_coupon_code      text default null,
  p_override_reason  text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name    text := btrim(coalesce(p_contact_name, ''));
  v_digits  text;
  v_phone   text;
  v_line1   text := btrim(coalesce(p_address_line1, ''));
  v_city    text := btrim(coalesce(p_city, ''));
  v_pincode text := btrim(coalesce(p_pincode, ''));
  v_snapshot jsonb;
begin
  if not public.is_admin() then
    raise exception 'Only the shop can take a phone order.'
      using errcode = '42501';
  end if;

  if length(v_name) < 2 then
    return jsonb_build_object('ok', false, 'error', 'contact_name_required');
  end if;

  -- `+91 98450 12345`, `919845012345` and `9845012345` are one number. Store
  -- the ten local digits; refuse anything that is not an Indian mobile.
  v_digits := regexp_replace(coalesce(p_contact_phone, ''), '\D', '', 'g');

  if length(v_digits) = 12 and left(v_digits, 2) = '91' then
    v_digits := substr(v_digits, 3);
  end if;

  if v_digits !~ '^[6-9][0-9]{9}$' then
    return jsonb_build_object('ok', false, 'error', 'contact_phone_invalid');
  end if;

  v_phone := v_digits;

  if length(v_line1) < 3 then
    return jsonb_build_object('ok', false, 'error', 'address_line1_required');
  end if;

  if v_pincode !~ '^[0-9]{6}$' then
    return jsonb_build_object('ok', false, 'error', 'address_pincode_invalid');
  end if;

  if v_city = '' then
    v_city := 'Kunigal';
  end if;

  -- The same shape `place_order` snapshots from a saved address, so every
  -- screen that reads a delivery address keeps working unchanged. The keys are
  -- ABSENT, not null, when there is no coordinate: same rule, same reason.
  v_snapshot := jsonb_build_object(
    'label', 'Phone order',
    'full_name', v_name,
    'phone', v_phone,
    'line1', v_line1,
    'line2', nullif(btrim(coalesce(p_address_line2, '')), ''),
    'landmark', nullif(btrim(coalesce(p_landmark, '')), ''),
    'city', v_city,
    'state', 'Karnataka',
    'pincode', v_pincode
  );

  if public.is_usable_fix(p_lat, p_lng) then
    v_snapshot := v_snapshot || jsonb_build_object('lat', p_lat, 'lng', p_lng);
  end if;

  return public.place_order_core(
    p_items,
    p_store_id,
    null,
    v_snapshot,
    p_idempotency_key,
    p_note,
    p_coupon_code,
    p_payment_method,
    false,          -- express is a measured promise; a typed address is not measured
    null,           -- no profile: the caller has no account
    'phone',
    v_name,
    v_phone,
    false,          -- no door pin to demand; the owner has a typed door
    true,           -- the owner may accept outside the area, with a reason
    p_override_reason
  );
end;
$$;

comment on function public.admin_place_phone_order(
  jsonb, uuid, text, text, text, text, text, text, text, text,
  double precision, double precision, text, public.payment_method, text, text
) is
  'The owner takes a phone order from the counter. Staff only (42501). '
  'Normalises the typed contact and address (and the attached coordinate, when '
  'the customer dropped one), then runs the same place_order_core() as '
  'source = ''phone'' with a NULL user_id. An order outside the delivery area '
  'or its served pincodes is accepted only with a reason of at least 3 '
  'characters, stored on the order.';

revoke all on function public.admin_place_phone_order(
  jsonb, uuid, text, text, text, text, text, text, text, text,
  double precision, double precision, text, public.payment_method, text, text
) from public, anon;
grant execute on function public.admin_place_phone_order(
  jsonb, uuid, text, text, text, text, text, text, text, text,
  double precision, double precision, text, public.payment_method, text, text
) to authenticated;
