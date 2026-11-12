-- =============================================================================
-- 36 · Per-customer coupon limits
-- =============================================================================
-- `coupons.usage_limit` (global cap) has existed since migration 14. One customer
-- could exhaust it entirely, which defeats the "one code per person" intent of
-- most shop offers. This migration adds a per-customer cap and enforces it in
-- both `validate_coupon()` and `place_order()`.
--
-- WHAT CHANGES
--   1. `coupons.per_customer_limit` — how many times ONE customer may use the
--      code. NULL = unlimited per customer. 0 is not allowed by the CHECK.
--   2. `validate_coupon()` — counts the customer's non-cancelled orders that
--      carry this code. If `per_customer_limit` is set and the count >= limit,
--      returns `coupon_per_customer_limit`.
--   3. `place_order()` — same check, same error. The count includes the order
--      about to be placed (it is not yet written, but the code is still the
--      same, so the preview and the order agree).
--   4. `active_offers()` is unchanged: it only advertises codes that have *any*
--      global headroom left. The per-customer check is personal and runs in the
--      checkout.
--   5. The checkout screen maps the new error to a translated message.
--
-- WHY A COUNT AND NOT A NEW TABLE
--   An order already stores `coupon_code`. Counting non-cancelled orders with
--   that code and this `user_id` is exact and costs one index scan on
--   `orders (user_id, coupon_code)`. No extra table, no trigger, no migration
--   of history.
--
-- =============================================================================

-- 1. The new column on coupons.
alter table public.coupons
  add column per_customer_limit integer check (per_customer_limit is null or per_customer_limit > 0);

comment on column public.coupons.per_customer_limit is
  'How many times ONE customer may use this code. NULL = unlimited per customer.';

-- 2. validate_coupon: add the per-customer count check.
create or replace function public.validate_coupon(
  p_store_id        uuid,
  p_code            text,
  p_subtotal_paise  integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_coupon  public.coupons%rowtype;
  v_code    text := upper(trim(coalesce(p_code, '')));
  v_now     timestamptz := now();
  v_used    bigint;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'error', 'not_logged_in');
  end if;

  if v_code = '' then
    return jsonb_build_object('ok', false, 'error', 'empty_code');
  end if;

  select * into v_coupon
    from public.coupons c
   where c.store_id = p_store_id and c.code = v_code;

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

  -- NEW: per-customer limit. Count non-cancelled orders from THIS customer
  -- carrying this code. The order about to be placed is not yet written, so
  -- the count is exactly what the customer has already used.
  if v_coupon.per_customer_limit is not null then
    select count(*) into v_used
      from public.orders o
     where o.user_id = auth.uid()
       and o.coupon_code = v_coupon.code
       and o.status <> 'cancelled';

    if v_used >= v_coupon.per_customer_limit then
      return jsonb_build_object('ok', false, 'error', 'coupon_per_customer_limit');
    end if;
  end if;

  if p_subtotal_paise < v_coupon.min_order_paise then
    return jsonb_build_object(
      'ok', false,
      'error', 'coupon_min_order',
      'min_order_paise', v_coupon.min_order_paise
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'code', v_coupon.code,
    'discount_paise', public.coupon_discount(v_coupon, p_subtotal_paise),
    'description_en', v_coupon.description_en,
    'description_kn', v_coupon.description_kn
  );
end;
$$;

comment on function public.validate_coupon(uuid, text, integer) is
  'Read-only coupon check for the checkout preview. Does not count a use. '
  'Refuses when the customer has already used the code up to per_customer_limit.';

-- 3. place_order: add the per-customer count check (same logic, same error).
--    The function body was last replaced by 20261107000001_door_pin.sql.
--    We keep the door pin logic and add the per-customer check after the
--    global usage_limit check.
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

    -- NEW: per-customer limit (same check as validate_coupon).
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

  -- 12. The order itself. Cash on Delivery only.
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
  'the saved address has usable coordinates. Enforces per-customer coupon limits.';

revoke execute on function public.place_order(jsonb, uuid, uuid, text, text, text) from public, anon;
grant execute on function public.place_order(jsonb, uuid, uuid, text, text, text) to authenticated, service_role;

revoke execute on function public.validate_coupon(uuid, text, integer) from public;
grant execute on function public.validate_coupon(uuid, text, integer) to authenticated, service_role;

revoke execute on function public.active_offers(uuid) from public;
grant execute on function public.active_offers(uuid) to anon, authenticated, service_role;