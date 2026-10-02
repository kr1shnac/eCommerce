-- =============================================================================
-- 08 · place_order() and cancel_order() — the only way to write an order
-- =============================================================================
-- Production standards 9.1 and 9.7:
--   * every price, fee and total is computed HERE, from the database, never
--     from a number the app sent;
--   * stock is decremented inside the same transaction, under a row lock, so
--     two buyers cannot both get the last packet;
--   * an idempotency key means a double tap or a retry returns the SAME order
--     instead of creating a second one;
--   * the direct-insert policies are dropped below, so the app physically
--     cannot bypass this function.
--
-- New in this file:
--   * orders.idempotency_key
--   * order numbers now look like KGL-000123 (was KNG-01001)
--   * store_settings.timezone, so open/closed is correct for IST
--   * delivery_zones.delivery_fee_paise may be NULL = "use the shop default"

-- -----------------------------------------------------------------------------
-- Schema additions
-- -----------------------------------------------------------------------------

alter table public.store_settings
  add column timezone text not null default 'Asia/Kolkata';

comment on column public.store_settings.timezone is
  'IANA timezone used for the open/closed check. Kunigal is Asia/Kolkata.';

alter table public.delivery_zones
  alter column delivery_fee_paise drop not null;

comment on column public.delivery_zones.delivery_fee_paise is
  'Fee for this pincode in paise. NULL means fall back to store_settings.';

alter table public.orders
  add column idempotency_key text
    check (idempotency_key is null or length(idempotency_key) between 8 and 200);

comment on column public.orders.idempotency_key is
  'Client-supplied key that makes placing an order safe to retry.';

create unique index orders_user_idempotency_key_idx
  on public.orders (user_id, idempotency_key)
  where idempotency_key is not null;

alter table public.orders
  alter column order_number
  set default ('KGL-' || lpad(nextval('public.order_number_seq')::text, 6, '0'));

-- -----------------------------------------------------------------------------
-- Lock the app out of direct writes
--
-- Before this file, a signed-in customer could INSERT into orders themselves.
-- Now they cannot: the only path is place_order(). The guard triggers stay in
-- place as a second line of defence for whoever does have write access.
-- -----------------------------------------------------------------------------

drop policy if exists "you can place your own order" on public.orders;
drop policy if exists "you can add items to your own order" on public.order_items;
drop policy if exists "you can cancel your own order, staff can update any order" on public.orders;

create policy "admins create orders"
  on public.orders for insert
  to authenticated
  with check (public.is_admin());

create policy "staff update orders"
  on public.orders for update
  to authenticated
  using (public.is_staff())
  with check (public.is_staff());

-- -----------------------------------------------------------------------------
-- place_order()
--
-- All or nothing. If anything is wrong it writes NOTHING and returns a machine
-- readable reason, so the app can explain it in the customer's language.
--
-- Return value (jsonb):
--   { "ok": true,  "order_id": "...", "order_number": "KGL-000123", ... }
--   { "ok": false, "error": "<code>", "items": [ ... ] }
--
-- Error codes the app must translate:
--   not_logged_in, invalid_idempotency_key, invalid_items, empty_cart,
--   address_not_found, store_not_found, zone_not_served, store_closed,
--   below_minimum, items_unavailable
-- -----------------------------------------------------------------------------

create or replace function public.place_order(
  p_items            jsonb,
  p_store_id         uuid,
  p_address_id       uuid,
  p_idempotency_key  text,
  p_note             text default null
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
  v_item        jsonb;
  v_order_id    uuid;
  v_order_number text;
  v_subtotal    bigint := 0;
  v_delivery_fee bigint := 0;
  v_total       bigint := 0;
  v_free_above  bigint;
  v_qty         integer;
  v_local_time  time;
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

  -- 7. Is the shop open right now? Timezone matters, or the shop would appear
  --    closed to a customer in another country.
  if not v_settings.is_open then
    return jsonb_build_object('ok', false, 'error', 'store_closed');
  end if;

  if v_settings.open_time is not null and v_settings.close_time is not null then
    v_local_time := (now() at time zone v_settings.timezone)::time;

    if v_settings.open_time <= v_settings.close_time then
      if v_local_time < v_settings.open_time or v_local_time >= v_settings.close_time then
        return jsonb_build_object('ok', false, 'error', 'store_closed');
      end if;
    else
      -- Overnight window, e.g. 22:00 to 02:00.
      if v_local_time < v_settings.open_time and v_local_time >= v_settings.close_time then
        return jsonb_build_object('ok', false, 'error', 'store_closed');
      end if;
    end if;
  end if;

  -- 8. Lock the product rows and price them FROM THE DATABASE.
  --    Iterating in product_id order means two simultaneous orders touching
  --    the same two products always lock them in the same order, so they queue
  --    instead of deadlocking.
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

    -- The price is read here, from the locked row. Whatever the client thought
    -- the price was is irrelevant.
    v_subtotal := v_subtotal + (v_product.price_paise::bigint * v_qty);
  end loop;

  -- 9. All or nothing: one bad line and the whole order is refused.
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

  -- 11. Delivery fee: this pincode's fee, else the shop default.
  --     Free above the free-delivery threshold.
  v_free_above := v_settings.free_delivery_above_paise;
  v_delivery_fee := coalesce(v_zone.delivery_fee_paise, v_settings.delivery_fee_paise);

  if v_free_above is not null and v_subtotal >= v_free_above then
    v_delivery_fee := 0;
  end if;

  v_total := v_subtotal + v_delivery_fee;

  -- 12. The order itself. Cash on Delivery only, so payment_method is not a
  --     parameter: the client cannot ask for something else.
  insert into public.orders (
    user_id, store_id, address_id, delivery_address,
    payment_method, payment_status,
    subtotal_paise, delivery_fee_paise, discount_paise, total_paise,
    notes, idempotency_key
  )
  values (
    v_uid, p_store_id, p_address_id,
    jsonb_build_object(
      'label', v_address.label,
      'full_name', v_address.full_name,
      'phone', v_address.phone,
      'line1', v_address.line1,
      'line2', v_address.line2,
      'landmark', v_address.landmark,
      'city', v_address.city,
      'state', v_address.state,
      'pincode', v_address.pincode
    ),
    'cod', 'pending',
    v_subtotal, v_delivery_fee, 0, v_total,
    nullif(trim(p_note), ''),
    p_idempotency_key
  )
  returning id, order_number into v_order_id, v_order_number;

  -- 13. Line items with a price snapshot, and the stock decrement, still
  --     inside this same transaction.
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

  return jsonb_build_object(
    'ok', true,
    'order_id', v_order_id,
    'order_number', v_order_number,
    'subtotal_paise', v_subtotal,
    'delivery_fee_paise', v_delivery_fee,
    'total_paise', v_total,
    'replayed', false
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- cancel_order()
--
-- A customer may cancel only while the order is still 'placed'. Stock goes back
-- on the shelf in the same transaction. Goes through a function so the app can
-- never do this with a raw UPDATE.
-- -----------------------------------------------------------------------------

create or replace function public.cancel_order(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders%rowtype;
  v_item  public.order_items%rowtype;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'error', 'not_logged_in');
  end if;

  select * into v_order
  from public.orders o
  where o.id = p_order_id and o.user_id = auth.uid();

  if not found then
    return jsonb_build_object('ok', false, 'error', 'order_not_found');
  end if;

  if v_order.status <> 'placed' then
    return jsonb_build_object(
      'ok', false,
      'error', 'cannot_cancel',
      'status', v_order.status
    );
  end if;

  -- The orders_guard_update trigger still applies inside this function and
  -- still only permits placed -> cancelled with no money touched.
  update public.orders set status = 'cancelled' where id = p_order_id;

  for v_item in
    select oi.*
    from public.order_items oi
    where oi.order_id = p_order_id and oi.product_id is not null
    order by oi.product_id
  loop
    update public.products
    set stock_qty = stock_qty + v_item.quantity
    where id = v_item.product_id;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'order_id', p_order_id,
    'order_number', v_order.order_number
  );
end;
$$;

comment on function public.place_order(jsonb, uuid, uuid, text, text) is
  'Places a Cash-on-Delivery order. All prices come from the database. All or nothing.';
comment on function public.cancel_order(uuid) is
  'Cancels an order that is still placed and puts the stock back.';

-- Only signed-in customers may call these.
revoke execute on function public.place_order(jsonb, uuid, uuid, text, text) from public;
revoke execute on function public.cancel_order(uuid) from public;

grant execute on function public.place_order(jsonb, uuid, uuid, text, text) to authenticated, service_role;
grant execute on function public.cancel_order(uuid) to authenticated, service_role;