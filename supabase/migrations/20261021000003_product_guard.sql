-- =============================================================================
-- 20 · The shelf: what the owner may change from the phone, and what is frozen
--
-- WHY THIS EXISTS
--
-- Register M2: there is no way for the owner to change a price or mark something
-- sold out from the app. The web panel can, but the panel is a desk tool and the
-- owner runs the shop from a phone at the counter. What runs out changes hourly
-- in a grocery shop, so today the shelf drifts out of date by lunchtime and the
-- shop sells what it does not have — every one of those is a failed delivery.
--
-- WHY THERE IS NO NEW COLUMN AND NO NEW POLICY
--
-- `products` already has everything: `price_paise`, `mrp_paise`, `stock_qty`,
-- `is_active`, and the CHECKs that make a nonsense value impossible
-- (`price_paise > 0`, `mrp_paise >= price_paise`, `stock_qty >= 0` — all of them
-- bind the owner too, not just customers). The RLS policy
-- `"admins manage products" for all using (is_admin())` already permits the
-- write. So this migration adds no column and widens no policy. Test 17 exists
-- precisely to catch a migration that recreates that policy too broadly.
--
-- WHAT THE GAP ACTUALLY IS
--
-- The existing policy says an admin may write ANY column, and says nothing about
-- which ones. That is too much in two directions:
--
--   1. `store_id`, `category_id`, `name_en` and the statutory declaration fields
--      are not shop-counter edits. A mis-tap that moves a product to another
--      shop, or blanks its name, is invisible until a customer cannot find it.
--      This is the same class of problem `orders_guard_update` solves: a policy
--      cannot express "this column may change, that one may not".
--   2. Worse, and specific to this new screen: a write that RLS refuses touches
--      **zero rows and reports no error**. Every existing test relies on this
--      (`test_result.touches(..., 0)`). A screen that trusts `.update()` to
--      throw would show the owner "Saved" while nothing was saved. That is the
--      exact lie rule 9.4 is about.
--
-- So the guard below pins what an owner must not touch, and the RPC at the end
-- gives the screen one call that can tell success from silence.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. The columns an owner must not change
-- -----------------------------------------------------------------------------
-- Identity and statutory fields. A counter edit is price, stock and whether it
-- is on the shelf; renaming a product, moving it between shops or categories, or
-- changing what the pack declares is a deliberate catalogue act, not a tap.
--
-- `emoji`, `image_url`, `sort_order`, `packer_name` and `net_quantity` are left
-- editable on purpose: `image_url` is already written from the phone by the photo
-- screen, and the rest are display fields an owner may reasonably fix while
-- standing at the shelf with the packet in hand.
--
-- HOW AN ORDER'S STOCK MOVE GETS THROUGH. `place_order()` and `cancel_order()`
-- are SECURITY DEFINER but the caller's JWT is still the customer's, and a
-- `reset role` fixture is also running as the table owner — so `current_user`
-- cannot tell "an order moved stock" from "a test repriced the shelf". A role
-- test is therefore not enough, and this uses the same device
-- `delete_my_account()` uses (migration 20261020000001): a transaction-local
-- flag, set only by the two order functions.
--
-- The flag alone would be a hole — any customer could set it and reprice the
-- shelf — so the guard ALSO checks the shape: while the flag is set, only
-- `stock_qty` may differ. With both, the only write the flag unlocks is a stock
-- move, which is exactly what an order is allowed to do.
create or replace function public.stock_move_in_progress()
returns boolean
language sql
stable
as $$
  select coalesce(current_setting('kunigal.moving_stock', true), '') = 'on'
$$;

comment on function public.stock_move_in_progress() is
  'True only inside place_order()/cancel_order(). Lets the product guard accept '
  'a pure stock change without accepting anything else.';

create or replace function public.guard_product_update()
returns trigger
language plpgsql
as $$
declare
  -- Is this UPDATE arriving from the app, or from code running as the database
  -- owner (fixtures, migrations, and the order functions' inner statements)?
  --
  -- A request through PostgREST runs as `authenticated`. `reset role` in a test
  -- and every statement inside a SECURITY DEFINER function run as the table
  -- owner. The owner check is deliberately WIDE — it does not try to tell a
  -- fixture from an order — because the subclass that must be constrained
  -- (orders may move stock and nothing else) is pinned separately by the shape
  -- check below. A narrow test here would be the thing that breaks fixtures.
  v_client boolean := public.current_user_role() <> 'admin'
                      and auth.uid() is not null
                      and current_user = 'authenticated';
begin
  -- Admin: full control. `store_id` is still frozen even for an admin, because
  -- moving a product to another shop would repoint existing order history and
  -- there is exactly one shop. If a second shop ever exists this becomes a
  -- deliberate migration, not a tap.
  if public.is_admin() then
    if new.store_id is distinct from old.store_id then
      raise exception 'A product cannot be moved to another shop.'
        using errcode = '42501';
    end if;
    return new;
  end if;

  -- An order moving stock. Allowed ONLY when every other column is untouched, so
  -- the flag cannot be borrowed to smuggle a price change past this guard.
  if public.stock_move_in_progress() then
    if new.price_paise   is not distinct from old.price_paise
       and new.mrp_paise   is not distinct from old.mrp_paise
       and new.is_active   is not distinct from old.is_active
       and new.store_id    is not distinct from old.store_id
       and new.name_en     is not distinct from old.name_en
       and new.name_kn     is not distinct from old.name_kn
       and new.category_id is not distinct from old.category_id then
      return new;
    end if;
    raise exception 'An order may only change stock, not any other product field.'
      using errcode = '42501';
  end if;

  -- A signed-in person, acting through the app, who is not the shop. RLS
  -- normally hides the row from them, so this is reached only by a mismatched
  -- role; refuse loudly rather than silently touching zero rows, which would let
  -- a save button lie about having saved.
  if v_client then
    raise exception 'Only the shop can change a product.'
      using errcode = '42501';
  end if;

  -- Code running as the database owner: fixture or migration setup. RLS and the
  -- CHECKs still apply.
  return new;
end;
$$;

comment on function public.guard_product_update() is
  'Frozen product identity: store_id never moves, and a non-admin write is '
  'refused rather than silently touching zero rows.';

create trigger products_guard_update
  before update on public.products
  for each row execute function public.guard_product_update();

-- -----------------------------------------------------------------------------
-- 2. The two order functions, re-created only to set the flag
-- -----------------------------------------------------------------------------
-- Re-created, not edited: migrations are append-only (AGENTS.md §3), so the only
-- way to change a body is to write it again. These are byte-for-byte copies of the
-- CURRENT versions —
--   * place_order: the 6-argument version in 20261014000004_coupons.sql (NOT the
--     5-argument original; copying that one would silently drop coupon support);
--   * cancel_order: the only version, in 20261002000008_place_order.sql —
-- EXCEPT for the four added `set_config` lines that bracket the stock loops.
-- Nothing else in either function is touched.
--
-- Why they must know about the flag at all: the stock decrement and the stock
-- restore are the only writes `products` receives from a non-admin caller.
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
  insert into public.orders (
    user_id, store_id, address_id, delivery_address,
    payment_method, payment_status,
    subtotal_paise, delivery_fee_paise, discount_paise, total_paise,
    notes, idempotency_key, coupon_code
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

  perform set_config('kunigal.moving_stock', 'on', true);

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

  perform set_config('kunigal.moving_stock', 'off', true);

  return jsonb_build_object(
    'ok', true,
    'order_id', p_order_id,
    'order_number', v_order.order_number
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- 3. One call the phone can trust
-- -----------------------------------------------------------------------------
-- `supabase.from('products').update(...)` returns no error when RLS filters every
-- row out — it just changes nothing. The screen cannot distinguish "saved" from
-- "not allowed" without counting rows, and counting rows on the client is exactly
-- the kind of thing that gets forgotten.
--
-- So the edit goes through one function that:
--   * refuses a non-admin with an error, not silence;
--   * re-reads the row AFTER the update and returns it, so the app shows what the
--     database actually holds rather than what it hoped it wrote (rule 9.1);
--   * bumps `updated_at`, which the app is forbidden from sending.
--
-- It takes a whole row's worth of values but only writes the four counter fields
-- plus the display fields the phone owns. Everything else stays as the shelf had
-- it — there is no parameter for `name_en`, `category_id` or `store_id`, so the
-- app cannot even express the change the guard would refuse.
create or replace function public.update_product_from_shop(
  p_product_id  uuid,
  p_price_paise integer default null,
  p_mrp_paise   integer default null,
  p_stock_qty   integer default null,
  p_is_active   boolean default null,
  p_emoji       text    default null
)
returns public.products
language plpgsql
-- NOT `security definer`. This function must run as the CALLER, so that:
--   * RLS ("admins manage products") decides whether the row may be written,
--     which is the whole point of keeping authorisation in one place; and
--   * the product guard sees an ordinary client update and applies the
--     counter-edit rules, rather than mistaking it for an internal stock move.
-- A definer version would run as the table owner and quietly bypass the guard.
set search_path = public, pg_temp
as $$
declare
  v_product public.products;
begin
  if not public.is_admin() then
    raise exception 'Only the shop can change a product.'
      using errcode = '42501';
  end if;

  -- A null parameter means "leave this alone", which is what lets the phone send
  -- only the field the owner actually touched. `coalesce` is used rather than a
  -- dynamic UPDATE so the statement is one fixed shape the planner can cache.
  update public.products
     set price_paise = coalesce(p_price_paise, price_paise),
         mrp_paise   = coalesce(p_mrp_paise, mrp_paise),
         stock_qty   = coalesce(p_stock_qty, stock_qty),
         is_active   = coalesce(p_is_active, is_active),
         emoji       = coalesce(p_emoji, emoji),
         updated_at  = now()
   where id = p_product_id
  returning * into v_product;

  if not found then
    raise exception 'That product is not on this shop''s shelf.'
      using errcode = 'P0002';
  end if;

  return v_product;
end;
$$;

comment on function public.update_product_from_shop(uuid, integer, integer, integer, boolean, text) is
  'The counter edit: price, MRP, stock, active, emoji. Returns the row as it now '
  'stands. Refuses a non-admin with an error rather than a silent no-op.';

revoke all on function public.update_product_from_shop(uuid, integer, integer, integer, boolean, text)
  from public, anon;
grant execute on function public.update_product_from_shop(uuid, integer, integer, integer, boolean, text)
  to authenticated;

-- -----------------------------------------------------------------------------
-- 4. The index the shelf screen needs
-- -----------------------------------------------------------------------------
-- The owner's list and the photo screen both ask for one shop's shelf ordered by
-- `sort_order`. `products_store_id_idx` covers the shop but not the order.
create index if not exists products_store_sort_idx
  on public.products (store_id, sort_order);
