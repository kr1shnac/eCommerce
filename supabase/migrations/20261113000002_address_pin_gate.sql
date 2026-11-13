-- =============================================================================
-- 43 · A delivery needs a door: address_pin_required
-- =============================================================================
-- WHY
-- ---
-- The door pin (migration 20261107000001) is how the rider finds the house on
-- a street with no numbers and how the distance rule measures the trip. It is
-- optional today, which was right while the shop's own pin did not exist —
-- nothing could be measured anyway. Once the owner stands in the shop and
-- drops the shop pin, every address WITHOUT a pin becomes the one kind of
-- delivery that cannot be found honestly: the rider gets a pincode, a guess
-- and a phone call.
--
-- This migration adds the hard gate for the pilot: a switch on the shop's
-- settings, `address_pin_required`, OFF by default and flipped ON by the
-- owner before the pilot starts. When it is ON and the SHOP has a usable pin,
-- an order whose address has no usable pin is refused with one actionable
-- sentence's worth of error code (`address_pin_required`) — the checkout says
-- "add a door pin to this address", and the address screen already knows how
-- to drop one.
--
-- WHY BOTH PINS ARE PART OF THE RULE
-- ----------------------------------
-- * The shop pin gates it because the whole point is measurable delivery. If
--   the shop has no pin, nothing is measured yet and the old pincode rule
--   still runs — refusing every un-pinned address would lock the shop out of
--   its own orders for a configuration problem.
-- * The address pin is judged by `is_usable_fix()`, the ONE definition of "a
--   coordinate that is a place" — inside the earth, not the null island, not
--   a string, not a 999. A pin at (0,0) is not a pin.
--
-- WHAT THE GATE DELIBERATELY DOES NOT DO
-- --------------------------------------
-- * It does not change how the DISTANCE works. An address WITH a pin is
--   measured; an address without one (when the gate is off) still falls back
--   to the pincode zone exactly as before.
-- * It does not touch addresses that already have a pin, and it never reads
--   the SNAPSHOT: the gate judges the address as it is NOW, at order time —
--   the snapshot keeps its own history.
--
-- The owner flips the switch from the phone: `update_delivery_settings()`
-- grows `p_address_pin_required`, beside the radius and the shop pin it
-- already owns. There is no bounds check for a boolean; there IS a warning
-- sentence on the card, because a shop that turns this on before its own pin
-- is set has switched on a rule that does nothing yet.
--
-- Rule 9.7: `supabase/tests/44_address_pin_gate_test.sql` proves the gate off
-- (unchanged behaviour), the gate on with each pin missing, and the switch
-- itself.
-- =============================================================================

alter table public.store_settings
  add column if not exists address_pin_required boolean not null default false;

comment on column public.store_settings.address_pin_required is
  'The pilot gate. When true and the shop has a usable pin, place_order() '
  'refuses an order whose address has no usable door pin. Off by default; '
  'the owner flips it from the Today tab when the shop is ready.';

-- -----------------------------------------------------------------------------
-- 1. The gate inside place_order(), in the "can the shop reach that door"
--    section. The body is the deployed function (migration 20261112000005)
--    with this one check added — nothing else moved.
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
  v_uid           uuid := auth.uid();
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
  v_has_fix       boolean;
  v_express_fee   bigint := 0;
  v_eta           integer;
  v_local_time    time;
  v_coupon_code   text;
  v_now           timestamptz := now();
  v_problems      jsonb := '[]'::jsonb;
  v_used          bigint;
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
      'payment_method', v_existing.payment_method,
      'is_express', v_existing.is_express,
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

  -- 6. Can the shop reach that door?
  --
  -- 6a. NEW: the pilot gate. When the shop demands a door pin and the shop's
  -- own pin exists, an address without a usable pin is not a delivery yet —
  -- the rider would get a pincode, a guess and a phone call. Judged by
  -- `is_usable_fix()`, the one definition of "a coordinate that is a place",
  -- on both sides. The refusal is one actionable sentence's worth of error
  -- code; the app maps it to "add a door pin to this address".
  if v_settings.address_pin_required
     and public.is_usable_fix(v_store.lat, v_store.lng)
     and not public.is_usable_fix(v_address.lat, v_address.lng) then
    return jsonb_build_object('ok', false, 'error', 'address_pin_required');
  end if;

  -- 6b. The pin decides when both pins exist. A listed pincode is not a
  -- guarantee of proximity, and an unlisted one is not proof of distance — a
  -- house 2 km away in a neighbouring pincode used to be refused for a reason
  -- that was no longer true once the shop had a pin.
  v_has_fix := public.is_usable_fix(v_store.lat, v_store.lng)
           and public.is_usable_fix(v_address.lat, v_address.lng);

  v_zone := null;

  if v_has_fix then
    v_distance := public.distance_metres(v_store.lat, v_store.lng, v_address.lat, v_address.lng);

    if v_distance > v_settings.delivery_radius_m then
      return jsonb_build_object(
        'ok', false,
        'error', 'outside_delivery_radius',
        'distance_m', round(v_distance)::integer,
        'radius_m', v_settings.delivery_radius_m
      );
    end if;

    -- Inside the radius. The pincode row is now only a fee/ETA override.
    select * into v_zone
      from public.delivery_zones z
     where z.store_id = p_store_id
       and z.pincode = v_address.pincode
       and z.is_active;
  else
    -- No pin on one side: the old pincode rule, unchanged.
    select * into v_zone
      from public.delivery_zones z
     where z.store_id = p_store_id and z.pincode = v_address.pincode;

    if not found or not v_zone.is_active then
      return jsonb_build_object('ok', false, 'error', 'zone_not_served');
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

    -- per-customer limit (same check as validate_coupon).
    if v_coupon.per_customer_limit is not null then
      select count(*) into v_used
        from public.orders o
       where o.user_id = v_uid
         and o.coupon_code = v_coupon.code
         and o.status <> 'cancelled';

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
    notes, idempotency_key, coupon_code,
    is_express, eta_minutes
  )
  values (
    v_uid, p_store_id, p_address_id, v_snapshot,
    p_payment_method, 'pending',
    v_subtotal, v_delivery_fee, v_discount, v_total,
    nullif(trim(p_note), ''),
    p_idempotency_key,
    nullif(v_coupon_code, ''),
    coalesce(p_express, false), v_eta
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
    'replayed', false
  );
end;
$$;

comment on function public.place_order(jsonb, uuid, uuid, text, text, text, public.payment_method, boolean) is
  'Places an order. All prices come from the database. All or nothing. The '
  'delivery address is snapshotted, including the door pin. Distance decides '
  'inside the configurable radius when both pins exist; the pincode zone is the '
  'fallback. When the shop''s address_pin_required gate is on and the shop has '
  'a usable pin, an address without a usable door pin is refused '
  '(address_pin_required). Refuses an online method unless the shop has '
  'enabled it. Records express and the promised ETA.';

revoke execute on function public.place_order(jsonb, uuid, uuid, text, text, text, public.payment_method, boolean) from public, anon;
grant execute on function public.place_order(jsonb, uuid, uuid, text, text, text, public.payment_method, boolean) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 2. The owner flips the gate from the phone, beside the radius and the pin.
--    The signature grows one named argument, and the OLD nine-argument
--    signature is DROPPED first: leave it in place and Postgres keeps BOTH
--    overloads, and every existing named-argument call
--    (`p_delivery_radius_m => ...`) becomes ambiguous — `could not choose a
--    best candidate function`. Dropping the old shape keeps the one call
--    every existing caller makes. Trailing arguments with defaults resolve
--    for positional callers too.
-- -----------------------------------------------------------------------------
drop function if exists public.update_delivery_settings(
  integer, boolean, integer, integer, integer, integer,
  double precision, double precision, boolean);

create or replace function public.update_delivery_settings(
  p_delivery_radius_m   integer default null,
  p_express_enabled     boolean default null,
  p_express_radius_m    integer default null,
  p_express_eta_minutes integer default null,
  p_express_fee_paise   integer default null,
  p_express_max_units   integer default null,
  p_lat                 double precision default null,
  p_lng                 double precision default null,
  p_clear_location      boolean default false,
  p_address_pin_required boolean default null
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
     set delivery_radius_m     = coalesce(p_delivery_radius_m, delivery_radius_m),
         express_enabled       = coalesce(p_express_enabled, express_enabled),
         express_radius_m      = coalesce(p_express_radius_m, express_radius_m),
         express_eta_minutes   = coalesce(p_express_eta_minutes, express_eta_minutes),
         express_fee_paise     = coalesce(p_express_fee_paise, express_fee_paise),
         express_max_units     = coalesce(p_express_max_units, express_max_units),
         address_pin_required  = coalesce(p_address_pin_required, address_pin_required),
         updated_at            = now()
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

comment on function public.update_delivery_settings(integer, boolean, integer, integer, integer, integer, double precision, double precision, boolean, boolean) is
  'Admin-only: the delivery radius, the express promise, the shop pin and the '
  'door-pin gate, in one transaction. Bounds are checked with actionable '
  'messages. Returns the stored settings and store row.';

revoke execute on function public.update_delivery_settings(integer, boolean, integer, integer, integer, integer, double precision, double precision, boolean, boolean) from public, anon;
grant execute on function public.update_delivery_settings(integer, boolean, integer, integer, integer, integer, double precision, double precision, boolean, boolean) to authenticated, service_role;
