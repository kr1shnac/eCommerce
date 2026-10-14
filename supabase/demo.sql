-- =============================================================================
-- Demo data — only ever run this on a development project, never in production.
-- =============================================================================
-- The seed file fills the shelves (categories + products). It leaves the shop
-- EMPTY of orders, so every screen that is about "what is happening" — the
-- customer's Orders tab, the rider's pool and list, the owner's board — starts
-- blank and looks broken.
--
-- This file fills them, so all three faces can be LOOKED AT and judged. It is
-- the answer to "show me the app working" without tapping through twenty orders
-- by hand.
--
-- HOW TO RUN
--   1. Sign in once in the app (that is what creates your profile row).
--   2. Supabase dashboard -> SQL Editor -> New query -> paste this -> Run.
--
-- WHO GETS THE DATA
--   * the customer: the first profile in the database, whatever its role
--     (so it works even if the only phone you have signed in is your own), plus
--     a delivery address in Kunigal (PIN 572130) if they had none;
--   * the rider: the first profile whose role is 'delivery', if one exists —
--     orders are only assigned to a rider who is actually there;
--   * the owner: sees every order on the board automatically.
--
-- It is safe to run more than once: it first deletes the orders it made last
-- time. Demo orders are the ones whose idempotency_key starts with
-- 'demo-order-', which no real order ever uses.
--
-- WHY THE TRIGGERS COME OFF FOR A MOMENT
--   `orders_guard_insert` exists so a CUSTOMER cannot invent an order that is
--   born delivered, or already paid; `order_items_guard_insert` is its twin for
--   the lines ("this order can no longer be changed"). The SQL Editor has no
--   signed-in user, so it looks like a customer, and every order would be forced
--   back to 'placed'/'pending' with no lines allowed on anything else. We
--   therefore switch those two triggers off for the handful of inserts below and
--   put them straight back — inside a sub-block, so that even if something fails
--   they are restored when the block unwinds. Nothing outside this file ever
--   disables a guard trigger.
--
-- MONEY: every total below is computed by Postgres from the real product prices
-- (rule 9.1), never typed in by hand. The CHECK constraint
-- (total = subtotal + fee - discount) is what guarantees it stays honest.
-- =============================================================================

do $$
declare
  v_store     uuid := '00000000-0000-4000-8000-000000000001';
  v_customer  uuid;
  v_rider     uuid;
  v_address   uuid;
  v_addr      public.addresses;
  v_snapshot  jsonb;
  v_order     uuid;
  v_subtotal  integer;
  v_total     integer;
  v_placed_at timestamptz;
  v_delivered timestamptz;
  v_spec      record;
begin
  -- ---------------------------------------------------------------------------
  -- Who are we dressing the shop for?
  -- ---------------------------------------------------------------------------
  select id into v_customer
    from public.profiles
   where role = 'customer'
   order by created_at
   limit 1;

  if v_customer is null then
    select id into v_customer from public.profiles order by created_at limit 1;
  end if;

  if v_customer is null then
    raise notice
      'demo.sql: no profiles exist yet. Sign in once in the app, then run this again.';
    return;
  end if;

  select id into v_rider
    from public.profiles
   where role = 'delivery'
   order by created_at
   limit 1;

  if v_rider is null then
    raise notice
      'demo.sql: no rider found, so every order will be left unclaimed. To see the '
      'rider face: sign in on a second phone, promote that account to Rider from '
      'the owner''s Team screen, then run this file again.';
  end if;

  -- ---------------------------------------------------------------------------
  -- An address to deliver to, in the town's real PIN (572130).
  -- ---------------------------------------------------------------------------
  select id into v_address
    from public.addresses
   where user_id = v_customer
   order by is_default desc, created_at
   limit 1;

  if v_address is null then
    insert into public.addresses (
      user_id, label, full_name, phone, line1, line2, landmark, city, pincode, is_default
    )
    values (
      v_customer, 'Home', 'Ramesh Gowda', '+919845600111',
      'No. 12, Main Road', 'Near Bus Stand', 'Ganesha Temple', 'Kunigal', '572130', true
    )
    returning id into v_address;
  end if;

  select * into v_addr from public.addresses where id = v_address;

  v_snapshot := jsonb_build_object(
    'label',     v_addr.label,
    'full_name', v_addr.full_name,
    'phone',     v_addr.phone,
    'line1',     v_addr.line1,
    'line2',     v_addr.line2,
    'landmark',  v_addr.landmark,
    'city',      v_addr.city,
    'state',     v_addr.state,
    'pincode',   v_addr.pincode
  );

  -- ---------------------------------------------------------------------------
  -- Start clean: drop whatever demo run came before this one.
  -- ---------------------------------------------------------------------------
  delete from public.orders
   where user_id = v_customer
     and idempotency_key like 'demo-order-%';

  -- ---------------------------------------------------------------------------
  -- The baskets. One row per (order, product, quantity); a temp table so the
  -- subtotal and the line items are worked out from the SAME list.
  -- ---------------------------------------------------------------------------
  create temp table if not exists demo_items (seq integer, product_id uuid, qty integer);
  truncate demo_items;

  insert into demo_items (seq, product_id, qty) values
    -- 1 · waiting: tomato, onion, milk
    (1, '20000000-0000-4000-8000-000000000001', 2),
    (1, '20000000-0000-4000-8000-000000000002', 1),
    (1, '20000000-0000-4000-8000-000000000006', 2),
    -- 2 · waiting: milk, curd, bread
    (2, '20000000-0000-4000-8000-000000000006', 1),
    (2, '20000000-0000-4000-8000-000000000007', 2),
    (2, '20000000-0000-4000-8000-000000000028', 1),
    -- 3 · confirmed: rice, dal, oil, salt (a monthly-basket shape)
    (3, '20000000-0000-4000-8000-000000000010', 1),
    (3, '20000000-0000-4000-8000-000000000013', 1),
    (3, '20000000-0000-4000-8000-000000000015', 1),
    (3, '20000000-0000-4000-8000-000000000019', 1),
    -- 4 · packing: tea, biscuits, sugar
    (4, '20000000-0000-4000-8000-000000000024', 2),
    (4, '20000000-0000-4000-8000-000000000022', 2),
    (4, '20000000-0000-4000-8000-000000000014', 1),
    -- 5 · out for delivery: cold drinks and snacks
    (5, '20000000-0000-4000-8000-000000000026', 2),
    (5, '20000000-0000-4000-8000-000000000020', 3),
    (5, '20000000-0000-4000-8000-000000000027', 2),
    -- 6 · delivered today: milk, curd, banana
    (6, '20000000-0000-4000-8000-000000000006', 2),
    (6, '20000000-0000-4000-8000-000000000007', 1),
    (6, '20000000-0000-4000-8000-000000000004', 2),
    -- 7 · delivered days ago: flour, detergent, soap
    (7, '20000000-0000-4000-8000-000000000012', 1),
    (7, '20000000-0000-4000-8000-000000000032', 1),
    (7, '20000000-0000-4000-8000-000000000033', 1),
    -- 8 · cancelled: paneer and butter (the customer changed their mind)
    (8, '20000000-0000-4000-8000-000000000008', 1),
    (8, '20000000-0000-4000-8000-000000000009', 1);

  -- ---------------------------------------------------------------------------
  -- Build the orders. Everything that writes to `orders` sits in the inner
  -- block, which is what guarantees the guard trigger is switched back on even
  -- if one of the inserts fails.
  -- ---------------------------------------------------------------------------
  begin
    alter table public.orders disable trigger orders_guard_insert;
    alter table public.order_items disable trigger order_items_guard_insert;

    for v_spec in
      select * from (values
        -- seq, status,               days, hours, mins, assign, with_time
        (1, 'placed'::text,           0,    0,    12,    false, false),
        (2, 'placed'::text,           0,    0,    47,    false, false),
        (3, 'confirmed'::text,        0,    3,     0,    true,  false),
        (4, 'packing'::text,          0,    4,    10,    true,  false),
        (5, 'out_for_delivery'::text, 0,    5,    30,    true,  false),
        (6, 'delivered'::text,        0,    7,     0,    true,  true),
        (7, 'delivered'::text,        2,    6,     0,    true,  true),
        (8, 'cancelled'::text,        4,    2,     0,    false, false)
      ) as t (seq, status, days_ago, hours_ago, mins_ago, assign, with_time)
    loop
      -- What the shop charged for THIS basket, from the shelf prices.
      select coalesce(sum(p.price_paise * di.qty), 0)
        into v_subtotal
        from demo_items di
        join public.products p on p.id = di.product_id
       where di.seq = v_spec.seq;

      if v_subtotal = 0 then
        raise notice 'demo.sql: order % skipped — its products are missing.', v_spec.seq;
        continue;
      end if;

      v_placed_at := now()
        - make_interval(days => v_spec.days_ago, hours => v_spec.hours_ago, mins => v_spec.mins_ago);
      v_delivered := case when v_spec.with_time then v_placed_at + interval '34 minutes' else null end;
      v_total     := v_subtotal + 1500;  -- PIN 572130 zone fee (Rs 15)

      insert into public.orders (
        order_number, user_id, store_id, address_id, delivery_address,
        status, payment_method, payment_status,
        subtotal_paise, delivery_fee_paise, discount_paise, total_paise,
        notes, placed_at, delivered_at, assigned_to, assigned_at, idempotency_key
      )
      values (
        'KNG-D' || lpad(v_spec.seq::text, 4, '0'),
        v_customer, v_store, v_address, v_snapshot,
        v_spec.status::public.order_status, 'cod',
        (case when v_spec.status = 'delivered' then 'paid' else 'pending' end)::public.payment_status,
        v_subtotal, 1500, 0, v_total,
        null, v_placed_at, v_delivered,
        case when v_spec.assign then v_rider else null end,
        case when v_spec.assign and v_rider is not null then v_placed_at + interval '3 minutes' else null end,
        'demo-order-' || v_spec.seq
      )
      returning id into v_order;

      -- The lines, snapshotting name and price exactly as place_order() does.
      insert into public.order_items (
        order_id, product_id, product_name_en, product_name_kn, unit, image_url,
        price_paise, quantity
      )
      select v_order, p.id, p.name_en, p.name_kn, p.unit, p.image_url, p.price_paise, di.qty
        from demo_items di
        join public.products p on p.id = di.product_id
       where di.seq = v_spec.seq;
    end loop;

    alter table public.orders enable trigger orders_guard_insert;
    alter table public.order_items enable trigger order_items_guard_insert;
  exception
    when others then
      -- Unwinding this block restores the triggers; just say what went wrong.
      raise;
  end;

  raise notice
    'demo.sql: done for customer %. % rider(s) found. 2 orders waiting, 3 on the road, '
    '1 delivered today, 1 delivered earlier, 1 cancelled, 1 address — across all three faces.',
    v_customer,
    (select count(*) from public.profiles where role = 'delivery');
end $$;

-- =============================================================================
-- Seeing the OTHER faces
-- -----------------------------------------------------------------------------
-- The owner board needs one account with role = 'admin'; the rider face needs
-- one with role = 'delivery'. Both are one line each, run once per account:
--
--   update public.profiles set role = 'admin'    where phone = '+91XXXXXXXXXX';
--   update public.profiles set role = 'delivery' where phone = '+91XXXXXXXXXX';
--
-- The SQL Editor is allowed to do this (no signed-in user); `profiles_guard_role`
-- still refuses the same update from inside the app. Once a rider exists, run
-- this file again and the orders above will be assigned to them.
-- =============================================================================
