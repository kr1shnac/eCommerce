#!/usr/bin/env node
/**
 * check-geo.mjs — the distance the checkout warns with must be the distance the
 * database refuses with.
 *
 * Run:  npm run check:geo
 *
 * WHY THIS EXISTS
 *
 * `apps/mobile/src/lib/geo.ts` mirrors two SQL functions from migration
 * 20261112000004: `distance_metres()` and `is_usable_fix()`. The app uses it to
 * tell the customer "that door is 14.5 km away, we deliver to 10 km" BEFORE
 * they place the order. The database uses the originals to refuse the order.
 *
 * If the two ever disagree, one of two bad things happens:
 *
 *   * the app says "we deliver to you" and `place_order()` refuses at the last
 *     tap, after the customer has filled a basket; or
 *   * the app says "too far" for a door the shop would have served, and the
 *     customer walks away for no reason.
 *
 * The three geographic points below are the SAME points asserted in
 * `supabase/tests/38_delivery_radius_test.sql`, with the same tolerances. That
 * is deliberate: it is the only way to catch a formula drift without a device.
 *
 * WHAT IT DOES NOT PROVE
 *
 * Nothing about how the warning reads on a phone, and nothing about the
 * database itself — `npm run test:db` owns that. This is the arithmetic.
 */
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const MODULE = pathToFileURL(join(root, 'apps/mobile/src/lib/geo.ts')).href;

const {
  distanceMetres,
  isUsableFix,
  radiusKmLabel,
  radiusVerdict,
  expressVerdict,
  EARTH_RADIUS_M,
} = await import(MODULE);

let failures = 0;
function expect(name, actual, wanted) {
  const a = JSON.stringify(actual);
  const w = JSON.stringify(wanted);
  const ok = a === w;
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) console.log(`        wanted ${w}\n        got    ${a}`);
}
function expectTrue(name, ok, detail = '') {
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok && detail) console.log(`        ${detail}`);
}
function between(name, value, low, high) {
  const ok = typeof value === 'number' && value >= low && value <= high;
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) console.log(`        wanted ${low}..${high}, got ${value}`);
}

// The shop's pin, and the three doors the SQL test uses.
const SHOP = { lat: 13.0316, lng: 77.0395 };
const AT_DOOR = { lat: 13.0316, lng: 77.0395 };
const NEAR = { lat: 13.0316 + 0.07, lng: 77.0395 }; // ~7.8 km
const FAR = { lat: 13.0316 + 0.13, lng: 77.0395 }; // ~14.5 km

console.log('\n— the formula —');

expect('the earth radius is the one the SQL function uses', EARTH_RADIUS_M, 6_371_000);
expectTrue(
  'the same point is zero metres',
  distanceMetres(SHOP.lat, SHOP.lng, AT_DOOR.lat, AT_DOOR.lng) < 0.001,
);
between(
  'one degree of latitude is ~111.2 km',
  distanceMetres(0, 77, 1, 77),
  111190,
  111200,
);
between(
  'Kunigal to Bangalore is ~60 km, not ~600',
  distanceMetres(13.0316, 77.0395, 12.9716, 77.5946),
  59000,
  62000,
);
between(
  'the shop to the near door is ~7.8 km',
  distanceMetres(SHOP.lat, SHOP.lng, NEAR.lat, NEAR.lng),
  7700,
  7900,
);
between('the shop to the far door is ~14.5 km', distanceMetres(SHOP.lat, SHOP.lng, FAR.lat, FAR.lng), 14400, 14500);

console.log('\n— a missing pin is null, never a confident zero —');

expect('null latitude in', distanceMetres(null, 77.0395, 13.0316, 77.0395), null);
expect('undefined longitude in', distanceMetres(13.0316, undefined, 13.0316, 77.0395), null);
expect('NaN in', distanceMetres(NaN, 77.0395, 13.0316, 77.0395), null);
expect('a string coordinate is refused', distanceMetres('13.03', 77.0395, 13.0316, 77.0395), null);
expect('the null island is not a place', distanceMetres(0, 0, 13.0316, 77.0395), null);
expect('out of bounds is not a place', distanceMetres(91, 77, 13.0316, 77.0395), null);

console.log('\n— isUsableFix mirrors the SQL —');

expectTrue('a real fix is usable', isUsableFix(13.0316, 77.0395));
expectTrue('(0,0) is not', !isUsableFix(0, 0));
expectTrue('a boundary latitude is usable', isUsableFix(90, 180));
expectTrue('one past the boundary is not', !isUsableFix(90.0001, 77));
expectTrue('a null pair is not', !isUsableFix(null, null));

console.log('\n— the checkout verdict —');

expect('both pins, inside 10 km', radiusVerdict(SHOP, NEAR, 10000).kind, 'inside');
expect('both pins, outside 10 km', radiusVerdict(SHOP, FAR, 10000).kind, 'outside');
expect(
  'the refusal carries the radius it broke',
  (() => {
    const v = radiusVerdict(SHOP, FAR, 10000);
    return v.kind === 'outside' ? v.radiusM : null;
  })(),
  10000,
);
between(
  'and the measured distance',
  (() => {
    const v = radiusVerdict(SHOP, FAR, 10000);
    return v.kind === 'outside' ? v.distanceM : null;
  })(),
  14400,
  14500,
);
expect('no shop pin falls back', radiusVerdict({ lat: null, lng: null }, FAR, 10000), {
  kind: 'unknown',
  reason: 'no_shop_pin',
});
expect('no address pin falls back', radiusVerdict(SHOP, { lat: null, lng: null }, 10000), {
  kind: 'unknown',
  reason: 'no_address_pin',
});
expect('no address at all falls back', radiusVerdict(SHOP, null, 10000), {
  kind: 'unknown',
  reason: 'no_address_pin',
});
expect('the same door inside 15 km after the owner widens it', radiusVerdict(SHOP, FAR, 15000).kind, 'inside');

console.log('\n— the express promise —');

const EXPRESS = {
  express_enabled: true,
  express_radius_m: 5000,
  express_eta_minutes: 30,
  express_fee_paise: 2000,
  express_max_units: 40,
};

expect('3.3 km, 6 units: available at 30 min', expressVerdict(EXPRESS, SHOP, { lat: 13.0316 + 0.03, lng: 77.0395 }, 6), {
  kind: 'available',
  feePaise: 2000,
  etaMinutes: 30,
});
expect('7.8 km is outside the 5 km express circle', expressVerdict(EXPRESS, SHOP, NEAR, 6), {
  kind: 'unavailable',
  reason: 'too_far',
});
expect('50 units is too big for 30 minutes', expressVerdict(EXPRESS, SHOP, AT_DOOR, 50), {
  kind: 'unavailable',
  reason: 'too_many_items',
});
expect('exactly the cap is allowed', expressVerdict(EXPRESS, SHOP, AT_DOOR, 40).kind, 'available');
expect('no pin means no promise', expressVerdict(EXPRESS, SHOP, null, 6), {
  kind: 'unavailable',
  reason: 'no_location',
});
expect(
  'switched off is refused first',
  expressVerdict({ ...EXPRESS, express_enabled: false }, SHOP, AT_DOOR, 1),
  { kind: 'unavailable', reason: 'disabled' },
);

console.log('\n— the number a sentence interpolates —');

expect('10 km reads as 10', radiusKmLabel(10000), '10');
expect('15 km reads as 15', radiusKmLabel(15000), '15');
expect('7.5 km reads as 7.5', radiusKmLabel(7500), '7.5');
expect('15.5 km reads as 15.5', radiusKmLabel(15500), '15.5');
expect('500 m reads as 0.5', radiusKmLabel(500), '0.5');
expect('no trailing .0', radiusKmLabel(20000), '20');

console.log(`\n${failures === 0 ? 'RESULT: all assertions passed' : `RESULT: ${failures} assertion(s) failed`}`);
process.exit(failures === 0 ? 0 : 1);
