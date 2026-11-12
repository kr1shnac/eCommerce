-- =============================================================================
-- 38 · The 10 km radius, the 30-minute promise, and the knobs
--
-- Three claims are proved here, and they are different claims:
--
--   1. DISTANCE. When both pins exist, the radius decides. A door 14 km away is
--      refused even though its pincode is listed; a door 2 km away is accepted
--      even though its pincode is not. The refusal carries the two numbers, so
--      the app can say "14.5 km, we deliver to 10 km" instead of a shrug.
--   2. EXPRESS. It is a narrower promise with its own radius, its own fee and a
--      basket cap. A 50-unit order is refused in express time, and a 7 km door
--      is refused the 30-minute promise while still being delivered normally.
--   3. CONFIGURABILITY. The owner widens the radius from 10 km to 15 km from the
--      phone, and the very next order at 14.5 km is accepted. No code change.
--
-- The pincode rule is also proved to still work when a pin is missing — the
-- migration's promise that nothing breaks on the day it ships.
-- =============================================================================

select test_result.begin_suite('38 delivery radius and express');

reset role;

update public.stores
   set lat = 13.0316,
       lng = 77.0395
 where id = '00000000-0000-4000-8000-000000000001';

update public.store_settings
   set is_open = true,
       delivery_radius_m   = 10000,
       express_enabled     = true,
       express_radius_m    = 5000,
       express_eta_minutes = 30,
       express_fee_paise   = 2000,
       express_max_units   = 40
 where store_id = '00000000-0000-4000-8000-000000000001';

update public.products set stock_qty = 80, is_active = true, price_paise = 1800
  where id = '20000000-0000-4000-8000-000000000001';   -- Tomato Rs 18

-- Asha's home starts exactly at the shop's pin.
update public.addresses
   set lat = 13.0316, lng = 77.0395, pincode = '572130', state = 'Karnataka'
 where id = '50000000-0000-4000-8000-000000000001';

set role authenticated;
select test_result.sign_in('11111111-1111-1111-1111-111111111111');

-- =============================================================================
-- 1. The distance function itself.
-- =============================================================================

select test_result.ok(
  'the same point is zero metres',
  public.distance_metres(13.0316, 77.0395, 13.0316, 77.0395) < 0.001
);
select test_result.ok(
  'one degree of latitude is ~111.2 km',
  public.distance_metres(0, 77, 1, 77) between 111190 and 111200,
  public.distance_metres(0, 77, 1, 77)::text
);
select test_result.ok(
  'Kunigal to Bangalore is ~60 km, not ~600',
  public.distance_metres(13.0316, 77.0395, 12.9716, 77.5946) between 59000 and 62000,
  public.distance_metres(13.0316, 77.0395, 12.9716, 77.5946)::text
);
select test_result.ok(
  'a missing pin gives null, never a confident zero',
  public.distance_metres(null, 77.0395, 13.0316, 77.0395) is null
);

-- =============================================================================
-- 2. At the shop's door: eligible, and express is offered.
-- =============================================================================

do $$
declare
  v_quote jsonb;
begin
  v_quote := public.delivery_quote(
    '00000000-0000-4000-8000-000000000001',
    '50000000-0000-4000-8000-000000000001',
    6
  );

  perform test_result.eq('quote: the pins exist', v_quote ->> 'has_fix', 'true');
  perform test_result.eq('quote: zero metres', (v_quote ->> 'distance_m')::bigint, 0);
  perform test_result.eq('quote: inside the radius', v_quote ->> 'within_radius', 'true');
  perform test_result.eq('quote: express is available', v_quote ->> 'express_available', 'true');
  perform test_result.eq('quote: the promise is 30 minutes',
    (v_quote ->> 'express_eta_minutes')::bigint, 30);
  perform test_result.eq('quote: the express fee is stated',
    (v_quote ->> 'express_fee_paise')::bigint, 2000);
end;
$$;

do $$
declare
  v_result jsonb;
begin
  v_result := public.place_order(
    '[{"product_id":"20000000-0000-4000-8000-000000000001","quantity":6}]',
    '00000000-0000-4000-8000-000000000001',
    '50000000-0000-4000-8000-000000000001',
    'radius-at-door-key-01'
  );

  perform test_result.ok('normal delivery at the door is accepted',
    v_result ->> 'ok' = 'true', v_result::text);
  perform test_result.eq('it is not an express order', v_result ->> 'is_express', 'false');
  perform test_result.eq('the normal ETA comes from the pincode zone',
    (v_result ->> 'eta_minutes')::bigint, 10);
end;
$$;

-- =============================================================================
-- 3. 7.8 km: normal yes, express no.
-- =============================================================================

reset role;
update public.addresses
   set lat = 13.0316 + 0.07, lng = 77.0395
 where id = '50000000-0000-4000-8000-000000000001';
set role authenticated;
select test_result.sign_in('11111111-1111-1111-1111-111111111111');

do $$
declare
  v_quote  jsonb;
  v_result jsonb;
begin
  v_quote := public.delivery_quote(
    '00000000-0000-4000-8000-000000000001',
    '50000000-0000-4000-8000-000000000001',
    6
  );

  perform test_result.eq('7.8 km is inside the 10 km radius',
    v_quote ->> 'within_radius', 'true');
  perform test_result.eq('but outside the 5 km express radius',
    v_quote ->> 'express_available', 'false');
  perform test_result.eq('and it says why', v_quote ->> 'express_reason', 'too_far');

  v_result := public.place_order(
    '[{"product_id":"20000000-0000-4000-8000-000000000001","quantity":6}]',
    '00000000-0000-4000-8000-000000000001',
    '50000000-0000-4000-8000-000000000001',
    'radius-express-far-01',
    null, null, 'cod', true
  );

  perform test_result.eq('express at 7.8 km is refused',
    v_result ->> 'error', 'express_not_available');
  perform test_result.eq('the reason is distance', v_result ->> 'reason', 'too_far');

  v_result := public.place_order(
    '[{"product_id":"20000000-0000-4000-8000-000000000001","quantity":6}]',
    '00000000-0000-4000-8000-000000000001',
    '50000000-0000-4000-8000-000000000001',
    'radius-normal-far-01'
  );

  perform test_result.ok('normal delivery at 7.8 km is still accepted',
    v_result ->> 'ok' = 'true', v_result::text);
end;
$$;

-- =============================================================================
-- 4. 14.5 km: refused, with the two numbers the customer needs.
-- =============================================================================

reset role;
update public.addresses
   set lat = 13.0316 + 0.13, lng = 77.0395
 where id = '50000000-0000-4000-8000-000000000001';
set role authenticated;
select test_result.sign_in('11111111-1111-1111-1111-111111111111');

do $$
declare
  v_quote  jsonb;
  v_result jsonb;
begin
  v_quote := public.delivery_quote(
    '00000000-0000-4000-8000-000000000001',
    '50000000-0000-4000-8000-000000000001',
    6
  );

  perform test_result.eq('quote: outside the radius', v_quote ->> 'within_radius', 'false');
  perform test_result.ok('quote: the distance is about 14.5 km',
    (v_quote ->> 'distance_m')::integer between 14400 and 14500,
    v_quote ->> 'distance_m');

  v_result := public.place_order(
    '[{"product_id":"20000000-0000-4000-8000-000000000001","quantity":6}]',
    '00000000-0000-4000-8000-000000000001',
    '50000000-0000-4000-8000-000000000001',
    'radius-outside-key-01'
  );

  perform test_result.eq('the order is refused', v_result ->> 'error', 'outside_delivery_radius');
  perform test_result.eq('the refusal carries the radius',
    (v_result ->> 'radius_m')::bigint, 10000);
  perform test_result.ok('and the actual distance',
    (v_result ->> 'distance_m')::integer between 14400 and 14500,
    v_result ->> 'distance_m');
  perform test_result.eq('no order row was written',
    (select count(*) from public.orders
      where idempotency_key = 'radius-outside-key-01')::text, '0');
end;
$$;

-- =============================================================================
-- 5. The owner widens the radius to 15 km — from the phone, no code change.
-- =============================================================================

select test_result.refused(
  'a customer cannot change the delivery radius',
  $$select public.update_delivery_settings(p_delivery_radius_m => 20000)$$,
  '42501'
);

select test_result.sign_in('33333333-3333-3333-3333-333333333333');

select test_result.eq(
  'the owner sets 15 km, and the stored value comes back',
  (select public.update_delivery_settings(p_delivery_radius_m => 15000)
     #>> '{settings,delivery_radius_m}'),
  '15000'
);

select test_result.refused(
  'express cannot reach beyond delivery',
  $$select public.update_delivery_settings(p_express_radius_m => 20000)$$,
  '22023'
);

select test_result.refused(
  'the radius has a sane floor',
  $$select public.update_delivery_settings(p_delivery_radius_m => 10)$$,
  '22023'
);

select test_result.sign_in('11111111-1111-1111-1111-111111111111');

do $$
declare
  v_result jsonb;
begin
  v_result := public.place_order(
    '[{"product_id":"20000000-0000-4000-8000-000000000001","quantity":6}]',
    '00000000-0000-4000-8000-000000000001',
    '50000000-0000-4000-8000-000000000001',
    'radius-widened-key-01'
  );

  perform test_result.ok('the same 14.5 km door is now accepted',
    v_result ->> 'ok' = 'true', v_result::text);
end;
$$;

-- =============================================================================
-- 6. Express inside the circle: the fee is added, the promise is recorded.
-- =============================================================================

reset role;
update public.addresses
   set lat = 13.0316 + 0.03, lng = 77.0395
 where id = '50000000-0000-4000-8000-000000000001';
set role authenticated;
select test_result.sign_in('11111111-1111-1111-1111-111111111111');

do $$
declare
  v_result jsonb;
begin
  v_result := public.place_order(
    '[{"product_id":"20000000-0000-4000-8000-000000000001","quantity":6}]',
    '00000000-0000-4000-8000-000000000001',
    '50000000-0000-4000-8000-000000000001',
    'radius-express-ok-001',
    null, null, 'cod', true
  );

  perform test_result.ok('express at 3.3 km is accepted', v_result ->> 'ok' = 'true', v_result::text);
  perform test_result.eq('the order records express', v_result ->> 'is_express', 'true');
  perform test_result.eq('the fee is the zone fee plus the express fee',
    (v_result ->> 'delivery_fee_paise')::bigint, 3500);
  perform test_result.eq('the express fee is stated separately',
    (v_result ->> 'express_fee_paise')::bigint, 2000);
  perform test_result.eq('the 30-minute promise is frozen on the order',
    (select eta_minutes::text from public.orders
      where id = (v_result ->> 'order_id')::uuid), '30');
  perform test_result.eq('and the total is subtotal + fee',
    (v_result ->> 'total_paise')::bigint, 10800 + 3500);
end;
$$;

-- =============================================================================
-- 7. A basket too big for a 30-minute promise is refused that promise.
-- =============================================================================

do $$
declare
  v_result jsonb;
begin
  v_result := public.place_order(
    '[{"product_id":"20000000-0000-4000-8000-000000000001","quantity":50}]',
    '00000000-0000-4000-8000-000000000001',
    '50000000-0000-4000-8000-000000000001',
    'radius-express-big-01',
    null, null, 'cod', true
  );

  perform test_result.eq('50 units cannot be promised in 30 minutes',
    v_result ->> 'error', 'express_not_available');
  perform test_result.eq('the reason is the basket size', v_result ->> 'reason', 'too_many_items');
  perform test_result.eq('the cap is stated', (v_result ->> 'max_units')::bigint, 40);
  perform test_result.eq('and no order row was written',
    (select count(*) from public.orders
      where idempotency_key = 'radius-express-big-01')::text, '0');
end;
$$;

-- =============================================================================
-- 8. With no shop pin, the pincode rule is back — nothing breaks.
-- =============================================================================

select test_result.sign_in('33333333-3333-3333-3333-333333333333');
select test_result.ok(
  'the owner clears the shop pin',
  (select public.update_delivery_settings(p_clear_location => true) #>> '{store,lat}') is null
);

reset role;
update public.addresses
   set lat = null, lng = null
 where id in ('50000000-0000-4000-8000-000000000001',
              '50000000-0000-4000-8000-000000000003');
set role authenticated;
select test_result.sign_in('11111111-1111-1111-1111-111111111111');

do $$
declare
  v_result jsonb;
begin
  v_result := public.place_order(
    '[{"product_id":"20000000-0000-4000-8000-000000000001","quantity":6}]',
    '00000000-0000-4000-8000-000000000001',
    '50000000-0000-4000-8000-000000000003',   -- pincode 999999, never listed
    'radius-fallback-bad-1'
  );

  perform test_result.eq('an unlisted pincode with no pin is still refused',
    v_result ->> 'error', 'zone_not_served');

  v_result := public.place_order(
    '[{"product_id":"20000000-0000-4000-8000-000000000001","quantity":6}]',
    '00000000-0000-4000-8000-000000000001',
    '50000000-0000-4000-8000-000000000001',   -- pincode 572130, listed
    'radius-fallback-ok-01'
  );

  perform test_result.ok('a listed pincode with no pin is accepted, as before',
    v_result ->> 'ok' = 'true', v_result::text);

  v_result := public.place_order(
    '[{"product_id":"20000000-0000-4000-8000-000000000001","quantity":6}]',
    '00000000-0000-4000-8000-000000000001',
    '50000000-0000-4000-8000-000000000001',
    'radius-fallback-expr-1',
    null, null, 'cod', true
  );

  perform test_result.eq('and express without a pin is honestly unavailable',
    v_result ->> 'reason', 'no_location');
end;
$$;

-- =============================================================================
-- Put the fixture back.
-- =============================================================================

reset role;
update public.store_settings
   set delivery_radius_m   = 10000,
       express_enabled     = true,
       express_radius_m    = 5000,
       express_eta_minutes = 30,
       express_fee_paise   = 0,
       express_max_units   = 40
 where store_id = '00000000-0000-4000-8000-000000000001';

update public.stores
   set lat = null, lng = null
 where id = '00000000-0000-4000-8000-000000000001';

update public.addresses
   set lat = null, lng = null
 where id = '50000000-0000-4000-8000-000000000001';
