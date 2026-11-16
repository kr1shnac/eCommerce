-- =============================================================================
-- 46 · The counter speaks too: phone orders on the one pricing and stock core
-- =============================================================================
-- Migration 20261113000006 splits `place_order` into an internal
-- `place_order_core()` and two thin doors: the customer app (unchanged
-- signature) and `admin_place_phone_order()` for the counter. The claims this
-- file makes true are:
--
--   1. STAFF ONLY. A customer and a rider are both refused with 42501. The
--      counter's door is not a second customer door.
--   2. THE APP DOOR IS UNCHANGED. A real `place_order` still works after the
--      refactor and still writes `source = 'app'` with no contact fields.
--   3. A PHONE ORDER LANDS as `source = 'phone'`, `user_id` NULL,
--      `address_id` NULL, with the typed contact and a SNAPSHOT of the typed
--      door. The money, stock, ETA and line totals are the database's own -
--      the same core the app uses, not a copy.
--   4. THE DATABASE REFUSES WHAT THE WRAPPER REFUSES. A phone order without a
--      reachable mobile or a name cannot be inserted even by a session that
--      bypasses the wrapper (23514).
--   5. IDEMPOTENCY. A double tap returns the first order and writes exactly
--      one row; the app and phone doors have separate key spaces.
--   6. THE OVERRIDE IS A DECISION, NOT A HOLE. Outside the served pincodes,
--      or beyond the measured radius, a phone order is refused until a reason
--      of at least 3 characters is given - and that reason is stored. An app
--      order has no such door at all.
--   7. THE COUPON IS RE-READ FROM THE DATABASE, including the per-customer
--      limit counted by the number that rang (the counter's only identity).
--   8. THE HANDOVER CODE. Once the bag is out, the owner can read the four
--      digits to the caller - and no customer and no rider can.
--   9. RLS STILL DECIDES WHO SEES IT. A NULL-user phone order is invisible to
--      every customer and visible to staff and riders.
--
-- A phone order has no measured address unless the owner attaches the
-- coordinate the caller dropped. Both branches are exercised: the pincode rule
-- when there is no coordinate, the distance rule when there is.
-- =============================================================================

select test_result.begin_suite('46 phone orders');

reset role;

-- The shelf is SET (the line guard copies the price from the products row).
update public.products
   set stock_qty = 80, is_active = true, price_paise = 1800
 where id = '20000000-0000-4000-8000-000000000001';   -- Tomato Rs 18
update public.products
   set stock_qty = 80, is_active = true, price_paise = 2600
 where id = '20000000-0000-4000-8000-000000000002';   -- Onion  Rs 26

-- The shop's own pin, so the measured-distance branch is real.
update public.stores
   set lat = 13.0316, lng = 77.0395
 where id = '00000000-0000-4000-8000-000000000001';

-- The gate is OFF for this suite so the app-door check is about the refactor,
-- not about the door pin. It is restored ON (the shipped default) at the end.
update public.store_settings
   set is_open = true,
       open_time = '00:00',
       close_time = '23:59',
       delivery_radius_m    = 10000,
       address_pin_required = false
 where store_id = '00000000-0000-4000-8000-000000000001';

-- A coupon this suite owns, so the seed's counters are never disturbed.
insert into public.coupons (
  id, store_id, code, kind, value, max_discount_paise, min_order_paise,
  is_active, description_en, description_kn
)
values (
  '62600000-0000-4000-8000-0000000000c1',
  '00000000-0000-4000-8000-000000000001',
  'PHONE5', 'percent', 5, 5000, 0, true,
  '5% off (phone order fixture)',
  'ಫೋನ್ ಆರ್ಡರ್‌ಗಳಿಗೆ 5% ರಿಯಾಯಿತಿ'
)
on conflict (id) do update
  set is_active = true,
      used_count = 0,
      per_customer_limit = null;

-- -----------------------------------------------------------------------------
-- 1. Staff only.
-- -----------------------------------------------------------------------------
set role authenticated;
select test_result.sign_in('11111111-1111-1111-1111-111111111111');   -- Asha

select test_result.refused(
  'a customer cannot take a phone order',
  $$
  select public.admin_place_phone_order(
    p_items           => '[{"product_id":"20000000-0000-4000-8000-000000000001","quantity":6}]',
    p_store_id        => '00000000-0000-4000-8000-000000000001',
    p_idempotency_key => 'phone-suite-customer-denied',
    p_contact_name    => 'Lakshmi',
    p_contact_phone   => '9845012345',
    p_address_line1   => '12, Gandhi Road',
    p_pincode         => '572130'
  )
  $$,
  '42501'
);

select test_result.sign_out();
select test_result.sign_in('44444444-4444-4444-4444-444444444444');   -- Rider

select test_result.refused(
  'a rider cannot take one either',
  $$
  select public.admin_place_phone_order(
    p_items           => '[{"product_id":"20000000-0000-4000-8000-000000000001","quantity":6}]',
    p_store_id        => '00000000-0000-4000-8000-000000000001',
    p_idempotency_key => 'phone-suite-rider-denied',
    p_contact_name    => 'Lakshmi',
    p_contact_phone   => '9845012345',
    p_address_line1   => '12, Gandhi Road',
    p_pincode         => '572130'
  )
  $$,
  '42501'
);

-- -----------------------------------------------------------------------------
-- 2. The app door is unchanged: the customer still orders, and the order is
--    still an app order.
-- -----------------------------------------------------------------------------
select test_result.sign_out();
select test_result.sign_in('11111111-1111-1111-1111-111111111111');   -- Asha

do $$
declare
  v_result jsonb;
begin
  v_result := public.place_order(
    '[{"product_id":"20000000-0000-4000-8000-000000000001","quantity":6},
      {"product_id":"20000000-0000-4000-8000-000000000002","quantity":3}]',
    '00000000-0000-4000-8000-000000000001',
    '50000000-0000-4000-8000-000000000001',
    'phone-suite-app-a1'
  );

  perform test_result.ok(
    'the customer app still places an order through the refactored door',
    v_result ->> 'ok' = 'true', v_result::text);

  perform test_result.eq(
    'and it is still an app order',
    v_result ->> 'source', 'app');
end;
$$;

select test_result.eq(
  'the app order belongs to its customer, with no counter contact fields',
  (select (user_id = '11111111-1111-1111-1111-111111111111')::text
       || '/' || (contact_name is null)::text
       || '/' || (contact_phone is null)::text
     from public.orders where idempotency_key = 'phone-suite-app-a1'),
  'true/true/true'
);

-- -----------------------------------------------------------------------------
-- 3. A phone order lands, priced and stocked by the same engine.
-- -----------------------------------------------------------------------------
select test_result.sign_out();
select test_result.sign_in('33333333-3333-3333-3333-333333333333');   -- Owner

-- What the shelf holds before the counter's order. The app order above has
-- already taken its own packs, so the assertion is a DELTA, not a hard-coded
-- shelf count.
drop table if exists phone_stock_before;
create temporary table phone_stock_before as
select
  (select stock_qty from public.products
    where id = '20000000-0000-4000-8000-000000000001') as tomato,
  (select stock_qty from public.products
    where id = '20000000-0000-4000-8000-000000000002') as onion;

do $$
declare
  v_result jsonb;
begin
  v_result := public.admin_place_phone_order(
    p_items           => '[{"product_id":"20000000-0000-4000-8000-000000000001","quantity":6},
                           {"product_id":"20000000-0000-4000-8000-000000000002","quantity":3}]',
    p_store_id        => '00000000-0000-4000-8000-000000000001',
    p_idempotency_key => 'phone-suite-p1',
    p_contact_name    => 'Lakshmi',
    p_contact_phone   => '+91 98450 12345',
    p_address_line1   => '12, Gandhi Road',
    p_address_line2   => 'Near the water tank',
    p_landmark        => 'Opposite the school',
    p_city            => 'Kunigal',
    p_pincode         => '572130',
    p_note            => 'Call before coming'
  );

  perform test_result.ok(
    'the owner takes a phone order from the counter',
    v_result ->> 'ok' = 'true', v_result::text);

  perform test_result.eq(
    'and the source says phone',
    v_result ->> 'source', 'phone');
end;
$$;

select test_result.eq(
  'a phone order has no user and no address row, but a reachable contact',
  (select (user_id is null)::text
       || '/' || (address_id is null)::text
       || '/' || contact_name
       || '/' || contact_phone
     from public.orders where idempotency_key = 'phone-suite-p1'),
  'true/true/Lakshmi/9845012345'
);

select test_result.eq(
  'the typed door was SNAPSHOTTED, not pointed at a row that does not exist',
  (select (delivery_address ->> 'line1')
       || '|' || (delivery_address ->> 'pincode')
       || '|' || (delivery_address ->> 'full_name')
       || '|' || (delivery_address ->> 'phone')
     from public.orders where idempotency_key = 'phone-suite-p1'),
  '12, Gandhi Road|572130|Lakshmi|9845012345'
);

select test_result.ok(
  'the snapshot carries no coordinate keys when none was given',
  (select not (delivery_address ? 'lat') and not (delivery_address ? 'lng')
     from public.orders where idempotency_key = 'phone-suite-p1')
);

select test_result.eq(
  'the phone order is an ordinary placed, unpaid, cash order',
  (select status::text || '/' || payment_status::text || '/' || payment_method::text
     from public.orders where idempotency_key = 'phone-suite-p1'),
  'placed/pending/cod'
);

select test_result.ok(
  'the order number and the invoice number were still assigned',
  (select order_number like 'KGL-%' and invoice_number like 'INV/%'
     from public.orders where idempotency_key = 'phone-suite-p1')
);

select test_result.ok(
  'express was not offered on a typed address',
  (select not is_express from public.orders
    where idempotency_key = 'phone-suite-p1')
);

select test_result.ok(
  'and no radius override was needed for a served pincode',
  (select radius_override_reason is null from public.orders
    where idempotency_key = 'phone-suite-p1')
);

-- The money: 6 × 1800 + 3 × 2600 = 18600; the 572130 zone's own fee 1500.
select test_result.eq(
  'the subtotal is the shelf price times the packs',
  (select subtotal_paise::text from public.orders
    where idempotency_key = 'phone-suite-p1'),
  '18600'
);

select test_result.eq(
  'the pincode''s own delivery fee was used',
  (select delivery_fee_paise::text from public.orders
    where idempotency_key = 'phone-suite-p1'),
  '1500'
);

select test_result.eq(
  'the total is the database''s own arithmetic (18600 + 1500)',
  (select total_paise::text from public.orders
    where idempotency_key = 'phone-suite-p1'),
  '20100'
);

select test_result.eq(
  'and the pincode''s own ETA',
  (select eta_minutes::text from public.orders
    where idempotency_key = 'phone-suite-p1'),
  '10'
);

select test_result.eq(
  'each line''s generated total is price × packs',
  (select string_agg(line_total_paise::text, ',' order by line_total_paise)
     from public.order_items
    where order_id = (select id from public.orders
                       where idempotency_key = 'phone-suite-p1')),
  '7800,10800'
);

select test_result.eq(
  'the phone order took exactly its 6 tomatoes from the same shelf',
  (select (b.tomato - p.stock_qty)::bigint
     from phone_stock_before b, public.products p
    where p.id = '20000000-0000-4000-8000-000000000001'),
  6::bigint
);

select test_result.eq(
  'and exactly its 3 onions',
  (select (b.onion - p.stock_qty)::bigint
     from phone_stock_before b, public.products p
    where p.id = '20000000-0000-4000-8000-000000000002'),
  3::bigint
);

-- -----------------------------------------------------------------------------
-- 4. What a phone order needs. The wrapper gives a sentence; the CHECK gives
--    the guarantee even to a session that never calls the wrapper.
-- -----------------------------------------------------------------------------
do $$
declare
  v_result jsonb;
begin
  v_result := public.admin_place_phone_order(
    p_items           => '[{"product_id":"20000000-0000-4000-8000-000000000001","quantity":6}]',
    p_store_id        => '00000000-0000-4000-8000-000000000001',
    p_idempotency_key => 'phone-suite-bad-name',
    p_contact_name    => ' ',
    p_contact_phone   => '9845012345',
    p_address_line1   => '12, Gandhi Road',
    p_pincode         => '572130'
  );
  perform test_result.eq(
    'a phone order needs a name', v_result ->> 'error', 'contact_name_required');

  v_result := public.admin_place_phone_order(
    p_items           => '[{"product_id":"20000000-0000-4000-8000-000000000001","quantity":6}]',
    p_store_id        => '00000000-0000-4000-8000-000000000001',
    p_idempotency_key => 'phone-suite-bad-phone-1',
    p_contact_name    => 'Lakshmi',
    p_contact_phone   => '0801234567',
    p_address_line1   => '12, Gandhi Road',
    p_pincode         => '572130'
  );
  perform test_result.eq(
    'a landline is not a delivery contact', v_result ->> 'error', 'contact_phone_invalid');

  v_result := public.admin_place_phone_order(
    p_items           => '[{"product_id":"20000000-0000-4000-8000-000000000001","quantity":6}]',
    p_store_id        => '00000000-0000-4000-8000-000000000001',
    p_idempotency_key => 'phone-suite-bad-phone-2',
    p_contact_name    => 'Lakshmi',
    p_contact_phone   => '98450',
    p_address_line1   => '12, Gandhi Road',
    p_pincode         => '572130'
  );
  perform test_result.eq(
    'a truncated number is refused too', v_result ->> 'error', 'contact_phone_invalid');

  v_result := public.admin_place_phone_order(
    p_items           => '[{"product_id":"20000000-0000-4000-8000-000000000001","quantity":6}]',
    p_store_id        => '00000000-0000-4000-8000-000000000001',
    p_idempotency_key => 'phone-suite-bad-line1',
    p_contact_name    => 'Lakshmi',
    p_contact_phone   => '9845012345',
    p_address_line1   => 'x',
    p_pincode         => '572130'
  );
  perform test_result.eq(
    'the door needs a line a rider can find', v_result ->> 'error', 'address_line1_required');

  v_result := public.admin_place_phone_order(
    p_items           => '[{"product_id":"20000000-0000-4000-8000-000000000001","quantity":6}]',
    p_store_id        => '00000000-0000-4000-8000-000000000001',
    p_idempotency_key => 'phone-suite-bad-pin',
    p_contact_name    => 'Lakshmi',
    p_contact_phone   => '9845012345',
    p_address_line1   => '12, Gandhi Road',
    p_pincode         => '57213'
  );
  perform test_result.eq(
    'a pincode is six digits', v_result ->> 'error', 'address_pincode_invalid');
end;
$$;

-- The wrapper is not the only guard: a direct insert that bypasses it must
-- still fail. This is Rule 9.7's forbidden case.
reset role;

select test_result.refused(
  'the database itself refuses a phone order with a landline',
  $$
  insert into public.orders (
    id, user_id, store_id, delivery_address,
    status, payment_method, payment_status,
    subtotal_paise, delivery_fee_paise, discount_paise, total_paise,
    source, contact_name, contact_phone
  )
  values (
    '92600000-0000-4000-8000-0000000000d1', null,
    '00000000-0000-4000-8000-000000000001',
    '{"line1":"12, Gandhi Road","pincode":"572130"}'::jsonb,
    'placed', 'cod', 'pending', 100, 0, 0, 100,
    'phone', 'Lakshmi', '0801234567'
  )
  $$,
  '23514'
);

select test_result.refused(
  'and one with no name',
  $$
  insert into public.orders (
    id, user_id, store_id, delivery_address,
    status, payment_method, payment_status,
    subtotal_paise, delivery_fee_paise, discount_paise, total_paise,
    source, contact_name, contact_phone
  )
  values (
    '92600000-0000-4000-8000-0000000000d2', null,
    '00000000-0000-4000-8000-000000000001',
    '{"line1":"12, Gandhi Road","pincode":"572130"}'::jsonb,
    'placed', 'cod', 'pending', 100, 0, 0, 100,
    'phone', null, '9845012345'
  )
  $$,
  '23514'
);

-- -----------------------------------------------------------------------------
-- 5. Idempotency: a double tap is one order, and the two doors have separate
--    key spaces (the app's key is scoped to its customer; the phone's to the
--    counter).
-- -----------------------------------------------------------------------------
set role authenticated;
select test_result.sign_in('33333333-3333-3333-3333-333333333333');   -- Owner

do $$
declare
  v_first  jsonb;
  v_second jsonb;
begin
  v_first := public.admin_place_phone_order(
    p_items           => '[{"product_id":"20000000-0000-4000-8000-000000000001","quantity":6}]',
    p_store_id        => '00000000-0000-4000-8000-000000000001',
    p_idempotency_key => 'phone-suite-replay',
    p_contact_name    => 'Lakshmi',
    p_contact_phone   => '9845012345',
    p_address_line1   => '12, Gandhi Road',
    p_pincode         => '572130'
  );

  v_second := public.admin_place_phone_order(
    p_items           => '[{"product_id":"20000000-0000-4000-8000-000000000001","quantity":6}]',
    p_store_id        => '00000000-0000-4000-8000-000000000001',
    p_idempotency_key => 'phone-suite-replay',
    p_contact_name    => 'Lakshmi',
    p_contact_phone   => '9845012345',
    p_address_line1   => '12, Gandhi Road',
    p_pincode         => '572130'
  );

  perform test_result.ok(
    'a double tap at the counter returns the first order',
    v_first ->> 'ok' = 'true'
    and v_second ->> 'ok' = 'true'
    and v_first ->> 'order_id' = v_second ->> 'order_id'
    and (v_second ->> 'replayed')::boolean,
    v_second::text);

  perform test_result.eq(
    'and exactly one order exists for that key',
    (select count(*)::text from public.orders
      where idempotency_key = 'phone-suite-replay'),
    '1');
end;
$$;

-- The same key through the app door is a DIFFERENT order: the app's unique
-- index is (user_id, key), the counter's is key-where-phone. They never meet.
select test_result.sign_out();
select test_result.sign_in('11111111-1111-1111-1111-111111111111');   -- Asha

do $$
declare
  v_result jsonb;
begin
  v_result := public.place_order(
    '[{"product_id":"20000000-0000-4000-8000-000000000001","quantity":6}]',
    '00000000-0000-4000-8000-000000000001',
    '50000000-0000-4000-8000-000000000001',
    'phone-suite-replay'
  );
  perform test_result.ok(
    'the same key through the app door is a separate order',
    v_result ->> 'ok' = 'true', v_result::text);
end;
$$;

-- Count as the owner: Asha's RLS cannot see the phone order, and the point is
-- what the TABLE holds, not what one customer may read.
select test_result.sign_out();
select test_result.sign_in('33333333-3333-3333-3333-333333333333');   -- Owner

select test_result.eq(
  'so the shared key holds one app order and one phone order',
  (select count(*)::text from public.orders
    where idempotency_key = 'phone-suite-replay'),
  '2'
);

-- -----------------------------------------------------------------------------
-- 6. The override: a decision with a recorded reason, never a silent hole.
-- -----------------------------------------------------------------------------
select test_result.sign_out();
select test_result.sign_in('33333333-3333-3333-3333-333333333333');   -- Owner

do $$
declare
  v_result jsonb;
begin
  -- 6a. An unserved pincode, no reason.
  v_result := public.admin_place_phone_order(
    p_items           => '[{"product_id":"20000000-0000-4000-8000-000000000001","quantity":6}]',
    p_store_id        => '00000000-0000-4000-8000-000000000001',
    p_idempotency_key => 'phone-suite-why-1',
    p_contact_name    => 'Lakshmi',
    p_contact_phone   => '9845012345',
    p_address_line1   => 'Near the temple, Narasapura',
    p_pincode         => '999999'
  );
  perform test_result.eq(
    'an unserved pincode is refused without a reason',
    v_result ->> 'error', 'override_reason_required');

  -- 6b. A reason too short to be one.
  v_result := public.admin_place_phone_order(
    p_items           => '[{"product_id":"20000000-0000-4000-8000-000000000001","quantity":6}]',
    p_store_id        => '00000000-0000-4000-8000-000000000001',
    p_idempotency_key => 'phone-suite-why-2',
    p_contact_name    => 'Lakshmi',
    p_contact_phone   => '9845012345',
    p_address_line1   => 'Near the temple, Narasapura',
    p_pincode         => '999999',
    p_override_reason => 'ok'
  );
  perform test_result.eq(
    'a two-character reason is not a reason',
    v_result ->> 'error', 'override_reason_required');

  -- 6c. The real decision.
  v_result := public.admin_place_phone_order(
    p_items           => '[{"product_id":"20000000-0000-4000-8000-000000000001","quantity":6}]',
    p_store_id        => '00000000-0000-4000-8000-000000000001',
    p_idempotency_key => 'phone-suite-why-3',
    p_contact_name    => 'Lakshmi',
    p_contact_phone   => '9845012345',
    p_address_line1   => 'Near the temple, Narasapura',
    p_pincode         => '999999',
    p_override_reason => 'Regular customer, rider knows the house'
  );
  perform test_result.ok(
    'the owner accepts an unserved pincode with a reason',
    v_result ->> 'ok' = 'true', v_result::text);
  perform test_result.ok(
    'and the answer says an override was applied',
    (v_result ->> 'radius_override_applied')::boolean);

  -- 6d. A measured distance beyond the radius, no reason.
  v_result := public.admin_place_phone_order(
    p_items           => '[{"product_id":"20000000-0000-4000-8000-000000000001","quantity":6}]',
    p_store_id        => '00000000-0000-4000-8000-000000000001',
    p_idempotency_key => 'phone-suite-far-1',
    p_contact_name    => 'Lakshmi',
    p_contact_phone   => '9845012345',
    p_address_line1   => 'The saw mill on the far road',
    p_pincode         => '572130',
    p_lat             => 13.0316 + 0.13,
    p_lng             => 77.0395
  );
  perform test_result.eq(
    'a measured distance beyond the radius is refused without a reason',
    v_result ->> 'error', 'override_reason_required');

  -- 6e. The same distance, with the reason.
  v_result := public.admin_place_phone_order(
    p_items           => '[{"product_id":"20000000-0000-4000-8000-000000000001","quantity":6}]',
    p_store_id        => '00000000-0000-4000-8000-000000000001',
    p_idempotency_key => 'phone-suite-far-2',
    p_contact_name    => 'Lakshmi',
    p_contact_phone   => '9845012345',
    p_address_line1   => 'The saw mill on the far road',
    p_pincode         => '572130',
    p_lat             => 13.0316 + 0.13,
    p_lng             => 77.0395,
    p_override_reason => 'Customer at the saw mill, 14 km; rider agreed'
  );
  perform test_result.ok(
    'the owner accepts a measured out-of-radius order with a reason',
    v_result ->> 'ok' = 'true', v_result::text);
  perform test_result.ok(
    'the refusal would have named a real measured distance',
    (v_result ->> 'distance_m')::integer > 10000,
    v_result ->> 'distance_m');

  -- 6f. Inside the radius, the coordinate is an ordinary door pin.
  v_result := public.admin_place_phone_order(
    p_items           => '[{"product_id":"20000000-0000-4000-8000-000000000001","quantity":6}]',
    p_store_id        => '00000000-0000-4000-8000-000000000001',
    p_idempotency_key => 'phone-suite-near-1',
    p_contact_name    => 'Lakshmi',
    p_contact_phone   => '9845012345',
    p_address_line1   => 'Behind the bus stand',
    p_pincode         => '572130',
    p_lat             => 13.0316 + 0.03,
    p_lng             => 77.0395
  );
  perform test_result.ok(
    'a coordinate inside the radius needs no reason',
    v_result ->> 'ok' = 'true', v_result::text);
  perform test_result.ok(
    'and the measured distance is under the radius',
    (v_result ->> 'distance_m')::integer < 10000,
    v_result ->> 'distance_m');
end;
$$;

select test_result.eq(
  'the accepted unserved-pincode order carries the exact reason typed',
  (select radius_override_reason from public.orders
    where idempotency_key = 'phone-suite-why-3'),
  'Regular customer, rider knows the house'
);

select test_result.eq(
  'with no zone row, the shop default fee and ETA apply',
  (select delivery_fee_paise::text || '/' || eta_minutes::text
     from public.orders where idempotency_key = 'phone-suite-why-3'),
  '2500/30'
);

select test_result.eq(
  'the measured override stores its reason too',
  (select radius_override_reason from public.orders
    where idempotency_key = 'phone-suite-far-2'),
  'Customer at the saw mill, 14 km; rider agreed'
);

select test_result.ok(
  'the near order stored the coordinate in the snapshot and no reason',
  (select (delivery_address ->> 'lat') is not null
       and (delivery_address ->> 'lng') is not null
       and radius_override_reason is null
     from public.orders where idempotency_key = 'phone-suite-near-1')
);

-- -----------------------------------------------------------------------------
-- 7. The coupon is the database's, and the per-person cap counts the number
--    that rang — the only identity the counter has.
-- -----------------------------------------------------------------------------
do $$
declare
  v_result jsonb;
begin
  v_result := public.admin_place_phone_order(
    p_items           => '[{"product_id":"20000000-0000-4000-8000-000000000001","quantity":6},
                           {"product_id":"20000000-0000-4000-8000-000000000002","quantity":3}]',
    p_store_id        => '00000000-0000-4000-8000-000000000001',
    p_idempotency_key => 'phone-suite-coupon-1',
    p_contact_name    => 'Lakshmi',
    p_contact_phone   => '9845012345',
    p_address_line1   => '12, Gandhi Road',
    p_pincode         => '572130',
    p_coupon_code     => 'PHONE5'
  );
  perform test_result.ok(
    'a coupon applies to a phone order through the same core',
    v_result ->> 'ok' = 'true', v_result::text);
  perform test_result.eq(
    '5% of 18600 is 930',
    v_result ->> 'discount_paise', '930');
  perform test_result.eq(
    'and the total is 18600 + 1500 − 930',
    v_result ->> 'total_paise', '19170');
end;
$$;

reset role;
update public.coupons
   set per_customer_limit = 1
 where code = 'PHONE5';
set role authenticated;
select test_result.sign_in('33333333-3333-3333-3333-333333333333');   -- Owner

do $$
declare
  v_result jsonb;
begin
  v_result := public.admin_place_phone_order(
    p_items           => '[{"product_id":"20000000-0000-4000-8000-000000000001","quantity":6}]',
    p_store_id        => '00000000-0000-4000-8000-000000000001',
    p_idempotency_key => 'phone-suite-limit-1',
    p_contact_name    => 'Lakshmi',
    p_contact_phone   => '9845012345',
    p_address_line1   => '12, Gandhi Road',
    p_pincode         => '572130',
    p_coupon_code     => 'PHONE5'
  );
  perform test_result.eq(
    'the same number cannot use the code twice',
    v_result ->> 'error', 'coupon_per_customer_limit');

  v_result := public.admin_place_phone_order(
    p_items           => '[{"product_id":"20000000-0000-4000-8000-000000000001","quantity":6}]',
    p_store_id        => '00000000-0000-4000-8000-000000000001',
    p_idempotency_key => 'phone-suite-limit-2',
    p_contact_name    => 'Gowda',
    p_contact_phone   => '9845099999',
    p_address_line1   => '45, Nehru Nagar',
    p_pincode         => '572130',
    p_coupon_code     => 'PHONE5'
  );
  perform test_result.ok(
    'but a different number still can — the cap is per person, not global',
    v_result ->> 'ok' = 'true', v_result::text);
end;
$$;

reset role;
update public.coupons
   set per_customer_limit = null
 where code = 'PHONE5';

-- -----------------------------------------------------------------------------
-- 8. The handover code: the owner reads the four digits to the caller.
-- -----------------------------------------------------------------------------
set role authenticated;
select test_result.sign_in('33333333-3333-3333-3333-333333333333');   -- Owner

update public.orders
   set status = 'out_for_delivery'
 where idempotency_key = 'phone-suite-p1';

select test_result.ok(
  'the owner can read the four digits for a phone order',
  (public.my_delivery_code((select id from public.orders
                             where idempotency_key = 'phone-suite-p1')) ->> 'ok') = 'true'
);

select test_result.ok(
  'and the code is four digits',
  (public.my_delivery_code((select id from public.orders
                             where idempotency_key = 'phone-suite-p1')) ->> 'code')
    ~ '^[0-9]{4}$'
);

-- Capture the id while the owner can still see the row: inside the refusal
-- below, Asha's own RLS would hide the order and turn the call into
-- `order_not_found` instead of the 42501 the ownership check must raise.
drop table if exists phone_code;
create temporary table phone_code as
select
  (select id from public.orders where idempotency_key = 'phone-suite-p1') as order_id,
  public.my_delivery_code((select id from public.orders
                            where idempotency_key = 'phone-suite-p1')) ->> 'code' as code;

select test_result.sign_out();
select test_result.sign_in('11111111-1111-1111-1111-111111111111');   -- Asha

select test_result.refused(
  'a customer cannot read a phone order''s handover code',
  $$
  select public.my_delivery_code((select order_id from phone_code))
  $$,
  '42501'
);

select test_result.sign_out();
select test_result.sign_in('44444444-4444-4444-4444-444444444444');   -- Rider

select test_result.refused(
  'and neither can the rider — that is what makes the handover mean something',
  $$
  select public.my_delivery_code((select order_id from phone_code))
  $$,
  '42501'
);

-- The code lives in a table no client role may read; compare from the owner.
reset role;
select test_result.eq(
  'and it is the same code the invisible table holds',
  (select code from phone_code),
  (select code from public.order_delivery_codes
    where order_id = (select id from public.orders
                       where idempotency_key = 'phone-suite-p1'))
);

-- -----------------------------------------------------------------------------
-- 9. RLS: a NULL-user order is nobody's order, and staff's order.
-- -----------------------------------------------------------------------------
set role authenticated;
select test_result.sign_in('11111111-1111-1111-1111-111111111111');   -- Asha

select test_result.eq(
  'no customer can see a phone order — it belongs to nobody',
  (select count(*)::text from public.orders
    where idempotency_key = 'phone-suite-p1'),
  '0'
);

select test_result.sign_out();
select test_result.sign_in('44444444-4444-4444-4444-444444444444');   -- Rider

select test_result.eq(
  'the rider can see it — somebody has to carry it',
  (select count(*)::text from public.orders
    where idempotency_key = 'phone-suite-p1'),
  '1'
);

select test_result.eq(
  'and its lines are visible to the rider too',
  (select count(*)::text from public.order_items
    where order_id = (select id from public.orders
                       where idempotency_key = 'phone-suite-p1')),
  '2'
);

select test_result.sign_out();
select test_result.sign_in('33333333-3333-3333-3333-333333333333');   -- Owner

select test_result.eq(
  'the owner sees it, as the shop must',
  (select count(*)::text from public.orders
    where idempotency_key = 'phone-suite-p1'),
  '1'
);

-- -----------------------------------------------------------------------------
-- 10. Cleanup: leave the graph as found.
-- -----------------------------------------------------------------------------
reset role;

delete from public.order_delivery_codes
 where order_id in (select id from public.orders
                     where idempotency_key like 'phone-suite-%');

delete from public.order_items
 where order_id in (select id from public.orders
                     where idempotency_key like 'phone-suite-%');

delete from public.orders
 where idempotency_key like 'phone-suite-%';

delete from public.coupons
 where id = '62600000-0000-4000-8000-0000000000c1';

update public.products
   set stock_qty = 40, is_active = true, price_paise = 1800
 where id = '20000000-0000-4000-8000-000000000001';
update public.products
   set stock_qty = 60, is_active = true, price_paise = 2600
 where id = '20000000-0000-4000-8000-000000000002';

update public.stores
   set lat = null, lng = null
 where id = '00000000-0000-4000-8000-000000000001';

update public.store_settings
   set address_pin_required = true,
       delivery_radius_m    = 10000
 where store_id = '00000000-0000-4000-8000-000000000001';

select test_result.eq(
  'fixture restored: no phone-order rows survive',
  (select count(*)::text from public.orders
    where idempotency_key like 'phone-suite-%'),
  '0'
);

select test_result.ok(
  'fixture restored: the gate is ON, the shipped default',
  (select address_pin_required from public.store_settings
    where store_id = '00000000-0000-4000-8000-000000000001')
);

drop table if exists phone_code;
