-- =============================================================================
-- 17 · coupons — the offers rail, and a discount the database computes
-- =============================================================================
-- A discount is money, so the same rule as every other price applies (9.1): the
-- customer may ask for a code, but the database decides whether it is valid and
-- by how much. Nothing the app sends is trusted.
--
-- Pieces:
--   * `coupons`               — the shop's codes. Admin-managed, not customer
--                               readable: the list of codes is not the shopfront,
--                               only a valid one is.
--   * `coupon_discount()`     — the ONE place the arithmetic lives, so the
--                               checkout preview and the real order can never
--                               disagree.
--   * `validate_coupon()`     — what the checkout screen calls to show "₹40 off"
--                               before the order is placed. Read-only.
--   * `active_offers()`       — the marketing-safe subset of live codes, for the
--                               Home offers rail (code + wording only; no usage
--                               counts, no limits).
--   * `place_order()`         — re-created to take `p_coupon_code`, lock the
--                               coupon row, apply the discount, and count a use.
--
-- Rules kept: discount never exceeds the subtotal (so a total is never
-- negative), the total still satisfies orders_totals_add_up, and a use is only
-- counted when the order is really written.
--
-- Rule 9.7: proved by supabase/tests/15_coupons_test.sql.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- The codes
-- -----------------------------------------------------------------------------
create table public.coupons (
  id                  uuid primary key default gen_random_uuid(),
  store_id            uuid        not null references public.stores (id) on delete cascade,
  code                text        not null,
  kind                text        not null check (kind in ('percent', 'flat')),
  -- percent: 1..100. flat: paise off.
  value               integer     not null check (value > 0),
  -- 0 means "no cap" (percent) / "ignore" (flat).
  max_discount_paise  integer     not null default 0 check (max_discount_paise >= 0),
  min_order_paise     integer     not null default 0 check (min_order_paise >= 0),
  is_active           boolean     not null default true,
  starts_at           timestamptz,
  ends_at             timestamptz,
  usage_limit         integer     check (usage_limit is null or usage_limit > 0),
  used_count          integer     not null default 0 check (used_count >= 0),
  description_en      text,
  description_kn      text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  unique (store_id, code),
  constraint coupons_percent_at_most_100 check (kind <> 'percent' or value <= 100),
  constraint coupons_dates check (starts_at is null or ends_at is null or starts_at < ends_at)
);

comment on table public.coupons is
  'Discount codes. Codes are matched uppercase. Money is always in paise.';
comment on column public.coupons.max_discount_paise is
  'Cap on a percent discount, in paise. 0 = no cap.';
comment on column public.coupons.usage_limit is
  'How many times the code may be used in total. NULL = unlimited.';

create trigger coupons_set_updated_at
  before update on public.coupons
  for each row execute function public.set_updated_at();

alter table public.coupons enable row level security;

-- Only the shop owner sees or edits the codes. A customer reaches one through
-- validate_coupon()/place_order()/active_offers() and nothing else.
create policy "admins manage coupons"
  on public.coupons for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- -----------------------------------------------------------------------------
-- The order remembers which code was used.
-- -----------------------------------------------------------------------------
alter table public.orders add column coupon_code text;

comment on column public.orders.coupon_code is
  'Code applied at checkout, or NULL. Kept on the order so history explains the discount.';

-- -----------------------------------------------------------------------------
-- coupon_discount: THE arithmetic. Kept in one function so the preview and the
-- placed order cannot drift apart.
-- -----------------------------------------------------------------------------
create or replace function public.coupon_discount(p_coupon public.coupons, p_subtotal integer)
returns integer
language sql
immutable
as $$
  select least(
    p_subtotal,
    case
      when p_coupon.kind = 'percent' then
        case
          when p_coupon.max_discount_paise > 0
            then least(
              floor(p_subtotal * p_coupon.value / 100.0)::integer,
              p_coupon.max_discount_paise
            )
          else floor(p_subtotal * p_coupon.value / 100.0)::integer
        end
      else
        p_coupon.value
    end
  );
$$;

comment on function public.coupon_discount(public.coupons, integer) is
  'Discount in paise for a coupon on a subtotal. Percent is floored, capped, and never exceeds the subtotal.';

-- -----------------------------------------------------------------------------
-- validate_coupon: read-only preview used by the checkout screen.
--
-- Returns { ok: true, code, discount_paise, description_en, description_kn }
-- or      { ok: false, error, min_order_paise? }.
-- Error codes: not_logged_in, empty_code, coupon_not_found, coupon_inactive,
--              coupon_not_started, coupon_expired, coupon_used_up,
--              coupon_min_order.
-- -----------------------------------------------------------------------------
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
  v_coupon public.coupons%rowtype;
  v_code   text := upper(trim(coalesce(p_code, '')));
  v_now    timestamptz := now();
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
  'Read-only coupon check for the checkout preview. Does not count a use.';

-- -----------------------------------------------------------------------------
-- active_offers: the marketing-safe subset for the Home offers rail.
-- -----------------------------------------------------------------------------
create or replace function public.active_offers(p_store_id uuid)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'code', c.code,
        'description_en', c.description_en,
        'description_kn', c.description_kn,
        'min_order_paise', c.min_order_paise
      )
      order by c.min_order_paise, c.code
    ),
    '[]'::jsonb
  )
  from public.coupons c
  where c.store_id = p_store_id
    and c.is_active
    and (c.starts_at is null or now() >= c.starts_at)
    and (c.ends_at is null or now() <= c.ends_at)
    and (c.usage_limit is null or c.used_count < c.usage_limit);
$$;

comment on function public.active_offers(uuid) is
  'Live coupon codes with their wording, for the customer-facing offers rail.';

-- -----------------------------------------------------------------------------
-- place_order(), re-created to accept a coupon code.
--
-- The old 5-argument signature is DROPPED first: a defaulted 6th argument would
-- otherwise leave two overloads and make the RPC call ambiguous.
-- -----------------------------------------------------------------------------
drop function public.place_order(jsonb, uuid, uuid, text, text);

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
    'discount_paise', v_discount,
    'coupon_code', nullif(v_coupon_code, ''),
    'total_paise', v_total,
    'replayed', false
  );
end;
$$;

comment on function public.place_order(jsonb, uuid, uuid, text, text, text) is
  'Places a Cash-on-Delivery order, optionally with a coupon. All prices come from the database. All or nothing.';

revoke execute on function public.place_order(jsonb, uuid, uuid, text, text, text) from public;
grant execute on function public.place_order(jsonb, uuid, uuid, text, text, text) to authenticated, service_role;

revoke execute on function public.validate_coupon(uuid, text, integer) from public;
grant execute on function public.validate_coupon(uuid, text, integer) to authenticated, service_role;

revoke execute on function public.active_offers(uuid) from public;
grant execute on function public.active_offers(uuid) to anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- guard_order_update(), re-created to also freeze coupon_code.
--
-- This is the definition from migration 20261013000001 (rider assignment) with
-- exactly two lines added: `coupon_code` joins the list of fields a rider may
-- not touch, and the list a customer may not touch while cancelling. A rider who
-- moves an order along must not be able to rewrite which code paid for it.
-- -----------------------------------------------------------------------------
create or replace function public.guard_order_update()
returns trigger
language plpgsql
as $$
declare
  v_old_rank integer;
  v_new_rank integer;
begin
  -- Admin: full control, nothing to check.
  if public.is_admin() then
    return new;
  end if;

  -- ---------------------------------------------------------------------------
  -- Delivery partner
  -- ---------------------------------------------------------------------------
  if public.current_user_role() = 'delivery' then
    -- Fields a rider may never change, whatever else they do. This is the same
    -- list migration 05 protected, plus idempotency_key, assigned_at and now
    -- coupon_code.
    if new.order_number  is distinct from old.order_number
       or new.user_id        is distinct from old.user_id
       or new.store_id       is distinct from old.store_id
       or new.address_id     is distinct from old.address_id
       or new.delivery_address is distinct from old.delivery_address
       or new.payment_method is distinct from old.payment_method
       or new.subtotal_paise is distinct from old.subtotal_paise
       or new.delivery_fee_paise is distinct from old.delivery_fee_paise
       or new.discount_paise is distinct from old.discount_paise
       or new.total_paise    is distinct from old.total_paise
       or new.coupon_code    is distinct from old.coupon_code
       or new.notes          is distinct from old.notes
       or new.placed_at      is distinct from old.placed_at
       or new.idempotency_key is distinct from old.idempotency_key then
      raise exception 'A delivery partner cannot change the details of an order.'
        using errcode = '42501';
    end if;

    -- Assignment. Either this is a claim (unassigned -> me) or the order was
    -- already mine and must stay mine.
    if new.assigned_to is distinct from old.assigned_to then
      if old.assigned_to is not null then
        raise exception 'This order is already assigned to a rider.'
          using errcode = '42501';
      end if;
      if new.assigned_to is distinct from auth.uid() then
        raise exception 'A rider may only claim an order for themselves.'
          using errcode = '42501';
      end if;
      if new.assigned_at is distinct from old.assigned_at
         and new.assigned_at is null then
        raise exception 'Claiming an order must record the time.'
          using errcode = '42501';
      end if;
    else
      -- Not a claim: the order must already be assigned to this rider.
      if old.assigned_to is distinct from auth.uid() then
        raise exception 'This order is not assigned to you.'
          using errcode = '42501';
      end if;
      if new.assigned_at is distinct from old.assigned_at then
        raise exception 'A rider cannot change when an order was claimed.'
          using errcode = '42501';
      end if;
    end if;

    -- Status may only move FORWARD, never back, and never to cancelled.
    if new.status is distinct from old.status then
      if new.status = 'cancelled' then
        raise exception 'A rider cannot cancel an order.'
          using errcode = '42501';
      end if;

      v_old_rank := case old.status
                      when 'placed'           then 1
                      when 'confirmed'        then 2
                      when 'packing'          then 3
                      when 'out_for_delivery' then 4
                      when 'delivered'        then 5
                      else 0
                    end;
      v_new_rank := case new.status
                      when 'placed'           then 1
                      when 'confirmed'        then 2
                      when 'packing'          then 3
                      when 'out_for_delivery' then 4
                      when 'delivered'        then 5
                      else 0
                    end;

      if v_new_rank <= v_old_rank then
        raise exception 'An order moves forward one step at a time.'
          using errcode = '42501';
      end if;
    end if;

    -- delivered_at is set when (and only when) the order is delivered.
    if new.status = 'delivered' then
      if new.delivered_at is null then
        raise exception 'Record the delivery time when marking an order delivered.'
          using errcode = '42501';
      end if;
    elsif new.delivered_at is distinct from old.delivered_at then
      raise exception 'Only a delivered order may record a delivery time.'
        using errcode = '42501';
    end if;

    return new;
  end if;

  -- ---------------------------------------------------------------------------
  -- Customer: may cancel, but only while the order is still unconfirmed, and
  -- may not touch any money, identity, assignment or coupon field while doing it.
  -- ---------------------------------------------------------------------------
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
     and new.coupon_code is not distinct from old.coupon_code
     and new.notes is not distinct from old.notes
     and new.placed_at is not distinct from old.placed_at
     and new.delivered_at is not distinct from old.delivered_at
     and new.assigned_to is not distinct from old.assigned_to
     and new.assigned_at is not distinct from old.assigned_at then
    return new;
  end if;

  raise exception 'Customers may only cancel an order that is still placed.';
end;
$$;
