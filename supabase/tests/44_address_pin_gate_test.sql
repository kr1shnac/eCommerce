-- =============================================================================
-- 44 · A delivery needs a door: the address_pin_required gate
-- =============================================================================
-- Migration 20261113000002 adds the pilot gate. The claims:
--
--   1. GATE OFF (the default): an address without a pin still orders, even
--      with the shop's own pin set — today's behaviour, unchanged.
--   2. GATE ON + shop pin set + unpinned address: REFUSED
--      (`address_pin_required`) — the rider would get a pincode, a guess and
--      a phone call.
--   3. GATE ON + shop pin set + PINNED address: the order goes through, and
--      the distance rule measures it as before (the gate is not a second
--      distance engine).
--   4. GATE ON + shop pin MISSING + unpinned address: accepted. The gate
--      waits for the shop's own pin; refusing every order while the shop pin
--      is unset would lock the shop out of its own shop for a configuration
--      gap. The pincode zone rule decides, exactly as before.
--   5. The owner flips the gate from the phone through
--      `update_delivery_settings(p_address_pin_required)`, it persists, and
--      a non-admin is refused (42501).
--
-- The gate judges the address as it is NOW, by `is_usable_fix()` — the one
-- definition of "a coordinate that is a place". The snapshot keeps its own
-- history; the gate never reads it.
-- =============================================================================

select test_result.begin_suite('44 address pin gate');

reset role;

-- The shelf is SET (the line guard copies the price from the products row).
update public.products
   set stock_qty = 80, is_active = true, price_paise = 1800
 where id = '20000000-0000-4000-8000-000000000001';   -- Tomato Rs 18
update public.products
   set stock_qty = 80, is_active = true, price_paise = 2600
 where id = '20000000-0000-4000-8000-000000000002';   -- Onion  Rs 26

-- The shop's pin and the radius the distance rule will use. The gate is OFF
-- for now: the default the migration gives the column.
update public.stores
   set lat = 13.0316, lng = 77.0395
 where id = '00000000-0000-4000-8000-000000000001';

update public.store_settings
   set is_open = true,
       delivery_radius_m    = 10000,
       address_pin_required = false
 where store_id = '00000000-0000-4000-8000-000000000001';

-- Two of Asha's addresses, both in the served 572130 zone: one pinned at the
-- shop's own point (distance 0), one deliberately without a pin. Re-runnable:
-- `on conflict do update` like suite 28.
insert into public.addresses
  (id, user_id, label, full_name, phone, line1, city, pincode, is_default, lat, lng)
values
  ('50000000-0000-4000-8000-0000000000c1',
   '11111111-1111-1111-1111-111111111111',
   'Pinned home', 'Asha', '+919800000001', '12, Gandhi Road', 'Kunigal', '572130', false,
   13.0316, 77.0395),
  ('50000000-0000-4000-8000-0000000000c2',
   '11111111-1111-1111-1111-111111111111',
   'Unpinned home', 'Asha', '+919800000001', '45, Nehru Nagar', 'Kunigal', '572130', false,
   null, null)
on conflict (id) do update
  set lat = excluded.lat, lng = excluded.lng, pincode = excluded.pincode,
      line1 = excluded.line1, is_default = false;

-- -----------------------------------------------------------------------------
-- 1. GATE OFF: today's behaviour, unchanged.
-- -----------------------------------------------------------------------------
set role authenticated;
select test_result.sign_in('11111111-1111-1111-1111-111111111111');   -- Asha

do $$
declare
  v_result jsonb;
begin
  v_result := public.place_order(
    '[{"product_id":"20000000-0000-4000-8000-000000000001","quantity":2},
      {"product_id":"20000000-0000-4000-8000-000000000002","quantity":3}]',
    '00000000-0000-4000-8000-000000000001',
    '50000000-0000-4000-8000-0000000000c2',
    'pin-gate-off-unpinned'
  );

  perform test_result.ok(
    'gate off: an unpinned address still orders, shop pin or not',
    v_result ->> 'ok' = 'true', v_result::text);
end;
$$;

-- -----------------------------------------------------------------------------
-- 2. The owner flips the gate from the phone. A customer cannot.
-- -----------------------------------------------------------------------------
select test_result.sign_out();
select test_result.sign_in('11111111-1111-1111-1111-111111111111');   -- Asha

select test_result.refused(
  'a customer cannot turn the gate on',
  $$ select public.update_delivery_settings(p_address_pin_required => true) $$,
  '42501'
);

select test_result.sign_out();
select test_result.sign_in('33333333-3333-3333-3333-333333333333');   -- Owner

select test_result.ok(
  'the owner turns the gate on, and the stored row says so',
  (public.update_delivery_settings(p_address_pin_required => true)
      -> 'settings' ->> 'address_pin_required')::boolean
);

-- -----------------------------------------------------------------------------
-- 3. GATE ON + shop pin: the unpinned door is refused, the pinned door is not.
-- -----------------------------------------------------------------------------
select test_result.sign_out();
select test_result.sign_in('11111111-1111-1111-1111-111111111111');   -- Asha

do $$
declare
  v_result jsonb;
begin
  v_result := public.place_order(
    '[{"product_id":"20000000-0000-4000-8000-000000000001","quantity":2},
      {"product_id":"20000000-0000-4000-8000-000000000002","quantity":3}]',
    '00000000-0000-4000-8000-000000000001',
    '50000000-0000-4000-8000-0000000000c2',
    'pin-gate-on-refused1'
  );

  perform test_result.eq(
    'gate on: the unpinned door is refused with the actionable error',
    v_result ->> 'error', 'address_pin_required');
end;
$$;

do $$
declare
  v_result jsonb;
  v_order  uuid;
begin
  v_result := public.place_order(
    '[{"product_id":"20000000-0000-4000-8000-000000000001","quantity":2},
      {"product_id":"20000000-0000-4000-8000-000000000002","quantity":3}]',
    '00000000-0000-4000-8000-000000000001',
    '50000000-0000-4000-8000-0000000000c1',
    'pin-gate-on-pinned-ok'
  );

  perform test_result.ok('gate on: the pinned door orders as before',
                         v_result ->> 'ok' = 'true', v_result::text);

  v_order := (v_result ->> 'order_id')::uuid;

  perform test_result.ok(
    'the distance rule still measured the pinned door (distance_m present)',
    (v_result ->> 'distance_m') is not null);

  perform test_result.ok(
    'and the snapshot still carries the door pin',
    (select delivery_address ? 'lat' from public.orders where id = v_order));
end;
$$;

-- -----------------------------------------------------------------------------
-- 4. GATE ON + shop pin missing: the gate waits, the pincode rule decides.
-- -----------------------------------------------------------------------------
select test_result.sign_out();
select test_result.sign_in('33333333-3333-3333-3333-333333333333');   -- Owner

update public.stores
   set lat = null, lng = null
 where id = '00000000-0000-4000-8000-000000000001';

select test_result.sign_out();
select test_result.sign_in('11111111-1111-1111-1111-111111111111');   -- Asha

do $$
declare
  v_result jsonb;
begin
  v_result := public.place_order(
    '[{"product_id":"20000000-0000-4000-8000-000000000001","quantity":2},
      {"product_id":"20000000-0000-4000-8000-000000000002","quantity":3}]',
    '00000000-0000-4000-8000-000000000001',
    '50000000-0000-4000-8000-0000000000c2',
    'pin-gate-no-shop-pin'
  );

  perform test_result.ok(
    'gate on but no shop pin: the unpinned door still orders (pincode rule)',
    v_result ->> 'ok' = 'true', v_result::text);
end;
$$;

-- -----------------------------------------------------------------------------
-- 5. Put the fixtures back: gate off, shop pin unset, addresses unpinned.
-- -----------------------------------------------------------------------------
select test_result.sign_out();
select test_result.sign_in('33333333-3333-3333-3333-333333333333');   -- Owner

select public.update_delivery_settings(p_address_pin_required => false);

reset role;

delete from public.order_items
  where order_id in (select id from public.orders
                      where idempotency_key like 'pin-gate-%');
delete from public.orders
  where idempotency_key like 'pin-gate-%';

update public.store_settings
   set address_pin_required = false
 where store_id = '00000000-0000-4000-8000-000000000001';

update public.stores
   set lat = null, lng = null
 where id = '00000000-0000-4000-8000-000000000001';

update public.addresses
   set lat = null, lng = null
 where id in ('50000000-0000-4000-8000-0000000000c1',
              '50000000-0000-4000-8000-0000000000c2');

update public.products
   set stock_qty = 40, is_active = true, price_paise = 1800
 where id = '20000000-0000-4000-8000-000000000001';
update public.products
   set stock_qty = 60, is_active = true, price_paise = 2600
 where id = '20000000-0000-4000-8000-000000000002';

select test_result.ok(
  'fixture restored: the gate is off again',
  (select not address_pin_required from public.store_settings
    where store_id = '00000000-0000-4000-8000-000000000001')
);
select test_result.ok(
  'fixture restored: the shop pin is unset again',
  (select lat is null and lng is null from public.stores
    where id = '00000000-0000-4000-8000-000000000001')
);
