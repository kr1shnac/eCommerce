-- =============================================================================
-- demo.sql — development-only sample data (NEVER run this on production)
-- =============================================================================
-- Everything a developer needs to SEE the app working, without tapping through a
-- month of orders by hand. It fills every data-driven screen:
--
--   customer  the Home "Saved" rail (favourites) and a real "Buy again" rail, the
--             Orders tab — 25 orders: one for every status in flight, plus six
--             weeks of delivered history behind them — one order carrying a real
--             coupon discount, and two delivery addresses for the checkout picker;
--   rider     a waiting pool to accept from, deliveries in progress, and
--             delivered-today history;
--   owner     a busy order board, with several orders already assigned to a rider.
--
-- It does NOT create products, categories, coupons, zones or store settings —
-- those come from seed.sql. This file touches only orders, favourites and
-- addresses, so removing it leaves the shop itself untouched.
--
-- HOW TO RUN (development only)
--   Option A: Supabase dashboard -> SQL Editor -> New query -> paste this whole
--             file -> Run.
--   Option B: psql "$DATABASE_URL" -f supabase/demo.sql
--
-- It needs at least one profile, so sign in once in the app first. It dresses the
-- FIRST customer profile (falling back to the first profile of any role, so it
-- works even if the only phone you have signed in is your own). If a profile with
-- role = 'delivery' exists, several orders are assigned to that rider; the owner
-- sees every order on the board automatically.
--
-- Brand-new project with no accounts at all? Run supabase/demo-accounts.sql
-- first: it makes a customer, a rider and an owner you can sign in as.
--
-- SAFE TO RE-RUN
--   It first deletes the orders it made last time. Demo orders are the ones whose
--   idempotency_key starts with 'demo-order-', which no real order ever uses. It
--   also rewrites the demo customer's favourites to a fixed shortlist, so a
--   second run replaces the sample data instead of stacking it.
--
-- HOW TO TAKE IT BACK OUT LATER
--   delete from public.orders
--    where idempotency_key like 'demo-order-%';
--   delete from public.favourites
--    where user_id = '<the demo customer uuid>';
--   -- then delete the extra "Work" address in the app's Addresses screen.
--   Nothing above touches the catalogue, the coupons, the zones or the settings.
--
-- WHY THE GUARD TRIGGERS COME OFF FOR A MOMENT
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
-- MONEY: every subtotal and total below is computed by Postgres from the real
-- product prices, and the coupon discount from the real `coupon_discount()`
-- function (rule 9.1), never typed in by hand. The CHECK constraint
-- (total = subtotal + fee - discount) is what guarantees it stays honest.
-- =============================================================================

do $$
declare
  v_store       uuid := '00000000-0000-4000-8000-000000000001';
  v_customer    uuid;
  v_rider       uuid;
  v_address     uuid;
  v_addr_count  integer;
  v_addr        public.addresses;
  v_snapshot    jsonb;
  v_order       uuid;
  v_subtotal    integer;
  v_total       integer;
  v_discount    integer;
  v_coupon_code text;
  v_placed_at   timestamptz;
  v_delivered   timestamptz;
  v_spec        record;
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
      'demo.sql: no rider yet — the demo orders will be left unassigned. Make a '
      'second account, set its profile role to ''delivery'', then run this again.';
  end if;

  -- ---------------------------------------------------------------------------
  -- Addresses. Make sure the customer has somewhere in Kunigal to deliver to,
  -- and a second address so the checkout picker has something to pick. Only
  -- added when the customer has fewer than two addresses of their own, so an
  -- existing list is never duplicated.
  -- ---------------------------------------------------------------------------
  select count(*)::integer into v_addr_count
    from public.addresses
   where user_id = v_customer;

  if v_addr_count = 0 then
    insert into public.addresses
      (user_id, label, full_name, phone, line1, line2, landmark, city, pincode, is_default)
    values
      (v_customer, 'Home', 'Ramesh Gowda', '+919845600111',
       'No. 12, Main Road', 'Near Bus Stand', 'Ganesha Temple', 'Kunigal', '572130', true);
    v_addr_count := 1;
  end if;

  if v_addr_count = 1 then
    insert into public.addresses
      (user_id, label, full_name, phone, line1, city, pincode, is_default)
    values
      (v_customer, 'Work', 'Ramesh Gowda', '+919845600111',
       'Near the market', 'Kunigal', '572130', false);
  end if;

  -- The address the orders point at: the default if there is one, else the oldest.
  select id into v_address
    from public.addresses
   where user_id = v_customer
   order by is_default desc, created_at
   limit 1;

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
  -- Start clean: drop whatever demo run came before this one, and reset the
  -- demo customer's shortlist to a known set (so the "Saved" rail is not empty).
  -- ---------------------------------------------------------------------------
  delete from public.orders
   where user_id = v_customer
     and idempotency_key like 'demo-order-%';

  delete from public.favourites where user_id = v_customer;

  -- A spread of the shortlist a real household keeps: a fruit, a daily dairy
  -- item, a staple, a snack and a drink. Only products on this store's shelf are
  -- saved, so a favourite can never point at a missing row.
  insert into public.favourites (user_id, product_id)
  select v_customer, p.id
    from public.products p
   where p.store_id = v_store
     and p.id in (
       '20000000-0000-4000-8000-000000000004',  -- Banana
       '20000000-0000-4000-8000-000000000006',  -- Full Cream Milk
       '20000000-0000-4000-8000-000000000010',  -- Sona Masoori Rice
       '20000000-0000-4000-8000-000000000022',  -- Biscuits
       '20000000-0000-4000-8000-000000000024'   -- Tea Powder
     );

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
    (8, '20000000-0000-4000-8000-000000000009', 1),
    -- 9 · waiting, and the one carrying a coupon: a big monthly basket that
    --     clears KUNIGAL50's Rs 499 minimum, so the discount is real.
    (9, '20000000-0000-4000-8000-000000000010', 1),
    (9, '20000000-0000-4000-8000-000000000011', 1),
    (9, '20000000-0000-4000-8000-000000000015', 1),
    (9, '20000000-0000-4000-8000-000000000016', 1),
    (9, '20000000-0000-4000-8000-000000000026', 2);

  -- ---------------------------------------------------------------------------
  -- 10 … 25 · six weeks of ordinary shopping. Nobody writes seventeen baskets by
  -- hand, so these are built from what this household actually repeats: milk and
  -- curd every single time, then the vegetables, biscuits, tea, rice, dal and oil
  -- rotating through the rest. Deterministic on purpose (a plain modulo, no
  -- random()), so two runs of demo.sql leave the same shop behind and the test
  -- can count it exactly. The modulo is deliberately over 11 and multiplies the
  -- two numbers rather than adding them, so no two weeks' baskets line up: a
  -- repeating total every third order is exactly what makes demo data look fake.
  -- ---------------------------------------------------------------------------
  insert into demo_items (seq, product_id, qty)
  select g.seq, s.product_id, s.qty
    from generate_series(10, 25) as g (seq)
    join (values
      (1,  '20000000-0000-4000-8000-000000000006'::uuid, 2, true),   -- Full Cream Milk
      (2,  '20000000-0000-4000-8000-000000000007'::uuid, 1, true),   -- Curd
      (3,  '20000000-0000-4000-8000-000000000004'::uuid, 1, false),  -- Banana
      (4,  '20000000-0000-4000-8000-000000000001'::uuid, 2, false),  -- Tomato
      (5,  '20000000-0000-4000-8000-000000000002'::uuid, 1, false),  -- Onion
      (6,  '20000000-0000-4000-8000-000000000003'::uuid, 1, false),  -- Potato
      (7,  '20000000-0000-4000-8000-000000000022'::uuid, 2, false),  -- Biscuits
      (8,  '20000000-0000-4000-8000-000000000024'::uuid, 1, false),  -- Tea Powder
      (9,  '20000000-0000-4000-8000-000000000010'::uuid, 1, false),  -- Sona Masoori Rice
      (10, '20000000-0000-4000-8000-000000000013'::uuid, 1, false),  -- Toor Dal
      (11, '20000000-0000-4000-8000-000000000015'::uuid, 1, false),  -- Sunflower Oil
      (12, '20000000-0000-4000-8000-000000000028'::uuid, 1, false)   -- Wheat Bread
    ) as s (ord, product_id, qty, always)
      on s.always or ((g.seq * 3 + s.ord * 5) % 11) < 5;

  -- ---------------------------------------------------------------------------
  -- Build the orders. Everything that writes to `orders` sits in the inner
  -- BEGIN...END block (a nested block shares this block's variables), which is
  -- what guarantees the guard trigger is switched back on when it unwinds.
  -- ---------------------------------------------------------------------------
  begin
    alter table public.orders disable trigger orders_guard_insert;
    alter table public.order_items disable trigger order_items_guard_insert;

    for v_spec in
      select * from (values
        -- seq | status | days_ago | hours_ago | mins_ago | assign | with_time | coupon
        (1, 'placed',           0, 1,  5, false, false, null::text),
        (2, 'placed',           0, 0, 40, false, false, null),
        (3, 'confirmed',        0, 3,  0, true,  false, null),
        (4, 'packing',          0, 5,  0, true,  false, null),
        (5, 'out_for_delivery', 0, 7,  0, true,  false, null),
        (6, 'delivered',        0, 8,  0, true,  true,  null),
        (7, 'delivered',        2, 6,  0, true,  true,  null),
        (8, 'cancelled',        4, 2,  0, false, false, null),
        (9, 'placed',           0, 0, 20, false, false, 'KUNIGAL50'),
        -- 10 … 25 · the last six weeks, delivered one at a time, spaced every two
        -- or three days. This is the history that makes "Buy again" worth having,
        -- and it is what a regular customer's Orders tab actually looks like.
        (10, 'delivered',        3, 10, 0, true, true, null),
        (11, 'delivered',        5,  9, 0, true, true, null),
        (12, 'delivered',        8, 11, 0, true, true, null),
        (13, 'delivered',       10,  8, 0, true, true, null),
        (14, 'delivered',       13, 10, 0, true, true, null),
        (15, 'delivered',       15,  9, 0, true, true, null),
        (16, 'delivered',       18, 11, 0, true, true, null),
        (17, 'delivered',       20,  8, 0, true, true, null),
        (18, 'delivered',       23, 10, 0, true, true, null),
        (19, 'delivered',       26,  9, 0, true, true, null),
        (20, 'delivered',       28, 11, 0, true, true, null),
        (21, 'delivered',       31,  8, 0, true, true, null),
        (22, 'delivered',       34, 10, 0, true, true, null),
        (23, 'delivered',       36,  9, 0, true, true, null),
        (24, 'delivered',       39, 11, 0, true, true, null),
        (25, 'delivered',       41,  8, 0, true, true, null)
      ) as t (seq, status, days_ago, hours_ago, mins_ago, assign, with_time, coupon)
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

      -- The discount, when this order uses a code: the SAME function the
      -- checkout calls, so the demo can never show a number the shop would not
      -- honour. A code under its minimum order simply gives nothing here.
      v_discount := 0;
      v_coupon_code := null;
      if v_spec.coupon is not null then
        select c.code,
               case when v_subtotal >= c.min_order_paise
                    then public.coupon_discount(c, v_subtotal)
                    else 0
               end
          into v_coupon_code, v_discount
          from public.coupons c
         where c.store_id = v_store
           and c.code = v_spec.coupon
           and c.is_active;
        v_discount := coalesce(v_discount, 0);
      end if;

      v_placed_at := now()
        - make_interval(days => v_spec.days_ago, hours => v_spec.hours_ago, mins => v_spec.mins_ago);
      v_delivered := case when v_spec.with_time then v_placed_at + interval '34 minutes' else null end;
      v_total     := v_subtotal + 1500 - v_discount;  -- PIN 572130 zone fee (Rs 15)

      insert into public.orders (
        order_number, user_id, store_id, address_id, delivery_address,
        status, payment_method, payment_status,
        subtotal_paise, delivery_fee_paise, discount_paise, total_paise,
        notes, placed_at, delivered_at, assigned_to, assigned_at,
        idempotency_key, coupon_code
      )
      values (
        'KNG-D' || lpad(v_spec.seq::text, 4, '0'),
        v_customer, v_store, v_address, v_snapshot,
        v_spec.status::public.order_status, 'cod',
        (case when v_spec.status = 'delivered' then 'paid' else 'pending' end)::public.payment_status,
        v_subtotal, 1500, v_discount, v_total,
        null, v_placed_at, v_delivered,
        case when v_spec.assign then v_rider else null end,
        case when v_spec.assign and v_rider is not null then v_placed_at + interval '3 minutes' else null end,
        'demo-order-' || v_spec.seq,
        v_coupon_code
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
    'demo.sql: done for customer %. % rider(s) found. 25 orders — six weeks of '
    'history plus one per live status, one carrying a coupon discount — a saved '
    'shortlist and Kunigal addresses, across all three faces.',
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
