-- =============================================================================
-- 28 · The door pin: an address carries coordinates, an order snapshots them,
--      and the ETA finally has somewhere to measure to.
--
-- Rule 9.7: nothing is done until the forbidden case fails too. The claims:
--
--   1. a saved address CAN carry a door pin, and a pin that is not a place
--      (out of bounds, or (0,0)) is REFUSED by the address table itself;
--   2. place_order() COPIES that pin into the order's snapshot, so the door on
--      a past order stays the door that order was actually sent to;
--   3. an address with no pin produces NO lat/lng keys at all — absent, never
--      null, and never zero;
--   4. moving the pin afterwards changes NOTHING about an order already placed
--      (a snapshot is a snapshot);
--   5. the customer cannot write an order any other way, so there is no second
--      path that could put a pin of its own choosing into a snapshot;
--   6. `order_rider_position` measures to the SNAPSHOT's pin when it has one,
--      falls back to the saved address when it does not, and returns NULL when
--      neither does — never an invented ETA.
--
--   Claim 6 is the one a customer feels. Every "how far is he" number in the
--   app has been silently absent until this migration; these assertions are
--   what stop it going quiet again.
-- =============================================================================

select test_result.begin_suite('28 door pin');

-- -----------------------------------------------------------------------------
-- Setup. Two of Asha's addresses: one with a pin on the door, one deliberately
-- without. Both in the served 572130 zone so place_order() accepts them.
-- Done as the table owner because none of this is what is under test.
-- -----------------------------------------------------------------------------

reset role;

-- A clean slate for the riders this file uses: no leftover out-for-delivery
-- order, because `record_my_position()` picks the most recently assigned live
-- order and would otherwise write onto somebody else's fixture.
--
-- The guards read auth.uid(), not the SQL role, so "the owner does this" means
-- signing in as the admin profile before the update — even while running as the
-- table owner. (This is the trap test 18 documents.)
select test_result.sign_in('33333333-3333-3333-3333-333333333333');

delete from public.rider_positions
 where rider_id in ('44444444-4444-4444-4444-444444444444',
                    '55555555-5555-5555-5555-555555555555');

update public.orders
   set assigned_to = null
 where assigned_to in ('44444444-4444-4444-4444-444444444444',
                       '55555555-5555-5555-5555-555555555555')
   and status = 'out_for_delivery';

-- Enough stock to place two baskets over the ₹100 minimum.
update public.products set stock_qty = 40, is_active = true, price_paise = 1800
  where id = '20000000-0000-4000-8000-000000000001';   -- Tomato  Rs 18
update public.products set stock_qty = 60, is_active = true, price_paise = 2600
  where id = '20000000-0000-4000-8000-000000000002';   -- Onion   Rs 26

insert into public.addresses
  (id, user_id, label, full_name, phone, line1, city, pincode, is_default, lat, lng)
values
  ('50000000-0000-4000-8000-00000000000a',
   '11111111-1111-1111-1111-111111111111',
   'Pinned home', 'Asha', '+919800000001', '12, Gandhi Road', 'Kunigal', '572130', false,
   13.0316, 77.0395),
  ('50000000-0000-4000-8000-00000000000b',
   '11111111-1111-1111-1111-111111111111',
   'Unpinned home', 'Asha', '+919800000001', '45, Nehru Nagar', 'Kunigal', '572130', false,
   null, null)
on conflict (id) do update
  set lat = excluded.lat, lng = excluded.lng, pincode = excluded.pincode,
      line1 = excluded.line1, is_default = false;

-- =============================================================================
-- 1. `is_usable_fix` — one definition of "a coordinate that is a place".
-- =============================================================================

select test_result.ok('a Kunigal fix is a place',
  public.is_usable_fix(13.0316, 77.0395));
select test_result.ok('the equator is a place',
  public.is_usable_fix(0, 77.4));
select test_result.ok('the poles are places',
  public.is_usable_fix(90, 0) and public.is_usable_fix(-90, 180));
select test_result.ok('a null latitude is not a place',
  not public.is_usable_fix(null, 77.0395));
select test_result.ok('a null longitude is not a place',
  not public.is_usable_fix(13.0316, null));
select test_result.ok('both null is not a place',
  not public.is_usable_fix(null, null));
select test_result.ok('91 degrees north is not a place',
  not public.is_usable_fix(91, 77.0395));
select test_result.ok('181 degrees east is not a place',
  not public.is_usable_fix(13.0316, 181));
select test_result.ok(
  '(0,0) is not a place — it is what a failed lookup reports',
  not public.is_usable_fix(0, 0));

-- The guard has to bite on the write path, not just in a helper: an out-of
-- range pin must never reach the snapshot at all.
select test_result.refused(
  'the address table itself refuses a latitude beyond 90',
  $$update public.addresses set lat = 91
     where id = '50000000-0000-4000-8000-00000000000a'$$,
  '23514'
);
select test_result.refused(
  'the address table itself refuses the null island',
  $$update public.addresses set lat = 0, lng = 0
     where id = '50000000-0000-4000-8000-00000000000a'$$,
  '23514'
);

-- =============================================================================
-- 2. place_order() copies the pin into the snapshot.
-- =============================================================================

set role authenticated;
select test_result.sign_in('11111111-1111-1111-1111-111111111111');

do $$
declare
  v_result  jsonb;
  v_order   uuid;
  v_lat     double precision;
  v_lng     double precision;
begin
  v_result := public.place_order(
    '[{"product_id":"20000000-0000-4000-8000-000000000001","quantity":2},
      {"product_id":"20000000-0000-4000-8000-000000000002","quantity":3}]',
    '00000000-0000-4000-8000-000000000001',
    '50000000-0000-4000-8000-00000000000a',
    'door-pin-with-a-fix-001'
  );

  perform test_result.ok('a pinned address still orders fine',
                        v_result ->> 'ok' = 'true', v_result::text);

  v_order := (v_result ->> 'order_id')::uuid;

  perform test_result.ok(
    'the snapshot carries a lat key',
    (select delivery_address ? 'lat' from public.orders where id = v_order));
  perform test_result.ok(
    'the snapshot carries an lng key',
    (select delivery_address ? 'lng' from public.orders where id = v_order));

  v_lat := (select (delivery_address ->> 'lat')::double precision
              from public.orders where id = v_order);
  v_lng := (select (delivery_address ->> 'lng')::double precision
              from public.orders where id = v_order);

  perform test_result.ok('the snapshotted latitude is the address''s own',
                        abs(v_lat - 13.0316) < 0.0000001, v_lat::text);
  perform test_result.ok('the snapshotted longitude is the address''s own',
                        abs(v_lng - 77.0395) < 0.0000001, v_lng::text);

  -- The pin is a *copy*: a jsonb number, not a string a screen would have to
  -- parse back. `->>` gives text either way, so compare the jsonb type.
  perform test_result.ok(
    'the snapshot''s lat is a JSON number, not text',
    (select jsonb_typeof(delivery_address -> 'lat') from public.orders where id = v_order)
      = 'number');

  -- And the snapshot is still the whole address, not just the pin.
  perform test_result.eq(
    'the snapshot still carries the landmark-bearing fields it always did',
    (select delivery_address ->> 'line1' from public.orders where id = v_order),
    '12, Gandhi Road');
end;
$$;

-- =============================================================================
-- 3. No pin means NO keys — absent, never null, and never zero.
-- =============================================================================

do $$
declare
  v_result jsonb;
  v_order  uuid;
begin
  v_result := public.place_order(
    '[{"product_id":"20000000-0000-4000-8000-000000000001","quantity":3},
      {"product_id":"20000000-0000-4000-8000-000000000002","quantity":3}]',
    '00000000-0000-4000-8000-000000000001',
    '50000000-0000-4000-8000-00000000000b',
    'door-pin-with-no-fix-002'
  );

  perform test_result.ok('an unpinned address still orders fine',
                        v_result ->> 'ok' = 'true', v_result::text);

  v_order := (v_result ->> 'order_id')::uuid;

  perform test_result.ok(
    'there is no lat key at all',
    not (select delivery_address ? 'lat' from public.orders where id = v_order));
  perform test_result.ok(
    'there is no lng key at all',
    not (select delivery_address ? 'lng' from public.orders where id = v_order));
  perform test_result.ok(
    'reading it back is null, so the app''s check is meaningful',
    (select delivery_address ->> 'lat' from public.orders where id = v_order) is null);
  perform test_result.ok(
    'a missing pin is not silently stored as the null island',
    (select (delivery_address ->> 'lat')::double precision
       from public.orders where id = v_order) is null);

  -- The screen reads `typeof snapshot.lat === 'number'`; a jsonb null would be
  -- the string 'null' and would never satisfy it, so this asserts the same rule
  -- the app uses.
  perform test_result.ok(
    'no null JSON value smuggled in either',
    (select jsonb_typeof(delivery_address -> 'lat') from public.orders where id = v_order)
      is null);
end;
$$;

-- =============================================================================
-- 4. A snapshot is a snapshot: moving the pin changes nothing already placed.
-- =============================================================================

reset role;
select test_result.sign_in('33333333-3333-3333-3333-333333333333');

update public.addresses
   set lat = 13.0500, lng = 77.0500, line1 = '99, Moved Road'
 where id = '50000000-0000-4000-8000-00000000000a';

set role authenticated;
select test_result.sign_in('11111111-1111-1111-1111-111111111111');

do $$
declare
  v_lat double precision;
begin
  v_lat := (select (delivery_address ->> 'lat')::double precision
              from public.orders
             where user_id = '11111111-1111-1111-1111-111111111111'
               and idempotency_key = 'door-pin-with-a-fix-001');

  perform test_result.ok(
    'the placed order still points at the door it was sent to',
    abs(v_lat - 13.0316) < 0.0000001, v_lat::text);
end;
$$;

select test_result.eq(
  'and the snapshot''s street line never rewrote itself either',
  (select delivery_address ->> 'line1' from public.orders
     where idempotency_key = 'door-pin-with-a-fix-001'),
  '12, Gandhi Road'
);

-- A NEW order, placed after the move, carries the NEW pin. That is the whole
-- point of snapshotting at write time rather than reading the address live.
do $$
declare
  v_result jsonb;
  v_lat   double precision;
begin
  v_result := public.place_order(
    '[{"product_id":"20000000-0000-4000-8000-000000000001","quantity":6}]',
    '00000000-0000-4000-8000-000000000001',
    '50000000-0000-4000-8000-00000000000a',
    'door-pin-after-the-move-003'
  );
  v_lat := (select (delivery_address ->> 'lat')::double precision
              from public.orders
             where id = (v_result ->> 'order_id')::uuid);
  perform test_result.ok('a later order snapshots the later pin',
                        abs(v_lat - 13.0500) < 0.0000001, v_lat::text);
end;
$$;

-- =============================================================================
-- 5. place_order() is the only way an order exists, so there is no second path
--    that could write a pin of the app's choosing.
-- =============================================================================

select test_result.refused(
  'a customer cannot insert an order directly and bypass the snapshot',
  $$
  insert into public.orders (user_id, store_id, address_id, delivery_address,
                             payment_method, payment_status,
                             subtotal_paise, delivery_fee_paise, total_paise)
  values ('11111111-1111-1111-1111-111111111111',
          '00000000-0000-4000-8000-000000000001',
          '50000000-0000-4000-8000-00000000000a',
          '{"line1":"fake","lat":99}'::jsonb,
          'cod', 'pending', 2000, 0, 2000)
  $$,
  '42501'
);

-- Row Level Security does not raise on an UPDATE that touches someone else's
-- row — it makes the row invisible, so the statement succeeds having changed
-- nothing. So the forbidden case here is "zero rows", not an exception.
select test_result.touches(
  '...and cannot update an existing order''s snapshot either',
  $$
  update public.orders
     set delivery_address = delivery_address || '{"lat":99}'::jsonb
   where idempotency_key = 'door-pin-with-a-fix-001'
  $$,
  0
);

-- =============================================================================
-- 6. The ETA measures to the door THIS ORDER was sent to.
-- =============================================================================

-- A second rider, so the fallback case below is a different person's delivery
-- rather than a race between two orders on one rider's single position row.
reset role;

insert into auth.users (id, phone, raw_user_meta_data)
values ('55555555-5555-5555-5555-555555555555', '+919800000005',
        '{"full_name":"Rider Two"}')
on conflict (id) do nothing;

update public.profiles
set role = 'delivery'
where id = '55555555-5555-5555-5555-555555555555';

delete from public.rider_positions
 where rider_id in ('44444444-4444-4444-4444-444444444444',
                    '55555555-5555-5555-5555-555555555555');

update public.orders
   set assigned_to = null
 where assigned_to in ('44444444-4444-4444-4444-444444444444',
                       '55555555-5555-5555-5555-555555555555')
   and status = 'out_for_delivery';

select test_result.sign_in('33333333-3333-3333-3333-333333333333');

-- The order from section 2: its snapshot pin is 13.0316,77.0395, while the live
-- address was moved to 13.0500,77.0500 in section 4. The two doors are ~1.4 km
-- and ~3.7 km from the fix below, so which one the view picks is measurable,
-- not a matter of interpretation.
select test_result.touches(
  'the owner releases the pinned order to rider one',
  $$update public.orders
       set assigned_to = '44444444-4444-4444-4444-444444444444',
           status = 'out_for_delivery'
     where id = (select id from public.orders
                  where idempotency_key = 'door-pin-with-a-fix-001')$$,
  1
);

set role authenticated;
select test_result.sign_in('44444444-4444-4444-4444-444444444444');

select public.record_my_position(13.0230, 77.0300, 10);

-- The view is only readable by the order's own customer or the shop owner, so
-- the distance assertions run as Asha — a rider, a stranger and a signed-out
-- caller all see nothing (test 24 proves those refusals).
set role authenticated;
select test_result.sign_in('11111111-1111-1111-1111-111111111111');

select test_result.ok(
  'with the delivery live, the customer can see a distance',
  exists (
    select 1 from public.order_rider_position
     where order_id = (select id from public.orders
                        where idempotency_key = 'door-pin-with-a-fix-001')
       and distance_m is not null
  )
);

select test_result.eq(
  'and it is the haversine distance to the snapshotted door, 1404.9 m',
  round((
    select distance_m from public.order_rider_position
     where order_id = (select id from public.orders
                        where idempotency_key = 'door-pin-with-a-fix-001')
  )::numeric, 1)::text,
  '1404.9'
);

select test_result.ok(
  'and it is emphatically NOT the 3702.4 m the moved address would give',
  exists (
    select 1 from public.order_rider_position
     where order_id = (select id from public.orders
                        where idempotency_key = 'door-pin-with-a-fix-001')
       and distance_m < 2000
  )
);

select test_result.ok(
  'an ETA arrives with it, floored and finite',
  exists (
    select 1 from public.order_rider_position
     where order_id = (select id from public.orders
                        where idempotency_key = 'door-pin-with-a-fix-001')
       and eta_minutes >= 3
       and eta_minutes <= 45
  )
);

-- The important one: the address was MOVED in section 4 and the order was not.
-- Measuring to the live address would give ~3.7 km, and the screen would then
-- disagree with its own map.
select test_result.ok(
  'the ETA measures to the SNAPSHOT''s door, not the moved address',
  exists (
    select 1
      from public.order_rider_position p
      join public.orders o on o.id = p.order_id
     where o.idempotency_key = 'door-pin-with-a-fix-001'
       and p.distance_m between 1350 and 1450
  )
);

-- -----------------------------------------------------------------------------
-- 6b. The fallback: an order placed when there was no pin, on an address that
--     now has one. The live address is the only door available, so it is used.
-- -----------------------------------------------------------------------------

reset role;
update public.addresses
   set lat = 13.0316, lng = 77.0395
 where id = '50000000-0000-4000-8000-00000000000b';

select test_result.sign_in('33333333-3333-3333-3333-333333333333');

select test_result.touches(
  'the owner releases the unpinned order to rider two',
  $$update public.orders
       set assigned_to = '55555555-5555-5555-5555-555555555555',
           status = 'out_for_delivery'
     where id = (select id from public.orders
                  where idempotency_key = 'door-pin-with-no-fix-002')$$,
  1
);

set role authenticated;
select test_result.sign_in('55555555-5555-5555-5555-555555555555');

-- The same fix, on the same street: a distance exists only because the live
-- address now carries a pin, and the snapshot has none.
select public.record_my_position(13.0230, 77.0300, 10);

set role authenticated;
select test_result.sign_in('11111111-1111-1111-1111-111111111111');

select test_result.ok(
  'an order placed with no pin still gets an ETA once its address has one',
  exists (
    select 1 from public.order_rider_position
     where order_id = (select id from public.orders
                        where idempotency_key = 'door-pin-with-no-fix-002')
       and distance_m is not null
  )
);

-- And when there is no pin anywhere, the numbers stay NULL. This is the
-- assertion that keeps the app from inventing an ETA from nothing.
reset role;
update public.addresses
   set lat = null, lng = null
 where id = '50000000-0000-4000-8000-00000000000b';

select test_result.ok(
  'no pin anywhere means NULL distance, not a guessed one',
  not exists (
    select 1 from public.order_rider_position
     where order_id = (select id from public.orders
                        where idempotency_key = 'door-pin-with-no-fix-002')
       and distance_m is not null
  )
);

select test_result.ok(
  'no pin anywhere means NULL eta too',
  not exists (
    select 1 from public.order_rider_position
     where order_id = (select id from public.orders
                        where idempotency_key = 'door-pin-with-no-fix-002')
       and eta_minutes is not null
  )
);

-- =============================================================================
-- 7. Leave the shelf as we found it.
-- =============================================================================

reset role;
select test_result.sign_in('33333333-3333-3333-3333-333333333333');

delete from public.rider_positions
 where rider_id in ('44444444-4444-4444-4444-444444444444',
                    '55555555-5555-5555-5555-555555555555');

update public.orders
   set assigned_to = null, status = 'placed'
 where idempotency_key in ('door-pin-with-a-fix-001',
                           'door-pin-with-no-fix-002',
                           'door-pin-after-the-move-003');

select test_result.sign_out();
