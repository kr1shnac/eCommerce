#!/usr/bin/env node
/**
 * check-tracking.mjs — the rider throttle, staleness and ETA rules.
 *
 * Run:  npm run check:tracking
 *
 * WHY THIS EXISTS
 *
 * `SCALE-AND-TRACKING.md` §6.4 and §6.6 define two promises that no screenshot
 * can verify:
 *
 *   1. **A rider is tracked only while carrying an order.** This is a privacy
 *      promise made to an employee, in Kannada, on a consent screen. If a refactor
 *      ever lets a fix through while the rider is idle, nobody would notice for
 *      months — the app would look identical.
 *   2. **A stale position is never shown as current.** This is a promise to the
 *      customer. A dot from twenty minutes ago is worse than no dot, because the
 *      customer walks to the road and waits.
 *
 * Both are decided by pure arithmetic in `src/lib/tracking-rules.ts`, so both can
 * be tested honestly here instead of by watching a map. That module cannot import
 * native code under Node, which is exactly why the rule was extracted from the
 * component in the first place.
 *
 * WHAT IT PROVES
 *
 *   1. Distance arithmetic is right, to a tolerance that matters at this scale.
 *   2. A rejected coordinate cannot be recorded, including the `0,0` a location
 *      library returns after it has failed.
 *   3. **A rider with no active delivery is never tracked, whatever else is true.**
 *   4. The two clocks behave: moving writes often, parked writes rarely, and a
 *      parked bike's GPS jitter does not keep resetting the fast clock.
 *   5. Stale, future-dated and low-accuracy positions are all refused.
 *   6. The ETA is a floor, a ceiling, and never a negative number.
 *   7. The function is pure — the same input twice gives the same answer, so a
 *      duplicate GPS callback cannot double-write.
 *
 * What this does NOT prove: that Android/iOS actually deliver the fixes, or what
 * a real battery does. Those need a device (`PRODUCTION.md` C4).
 */
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const {
  shouldRecordPosition,
  shouldWriteOnBackground,
  isPositionShowable,
  positionAgeSeconds,
  distanceMetres,
  isValidFix,
  etaMinutesFor,
  formatDistance,
  hasArrived,
  MOVING_INTERVAL_MS,
  STATIONARY_INTERVAL_MS,
  STALE_AFTER_MS,
  MIN_MOVED_METRES,
  ETA_FLOOR_MINUTES,
  ETA_CEILING_MINUTES,
  MAX_USABLE_ACCURACY_M,
  ARRIVED_METRES,
} = await import(pathToFileURL(join(root, 'apps/mobile/src/lib/tracking-rules.ts')).href);

let failures = 0;
function expect(name, actual, wanted) {
  const a = JSON.stringify(actual);
  const w = JSON.stringify(wanted);
  const ok = a === w;
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) console.log(`        wanted ${w}\n        got    ${a}`);
}
function expectTrue(name, ok, detail) {
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok && detail) console.log(`        ${detail}`);
}
function expectNear(name, actual, wanted, tolerance) {
  const ok = Number.isFinite(actual) && Math.abs(actual - wanted) <= tolerance;
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) console.log(`        wanted ${wanted} ± ${tolerance}\n        got    ${actual}`);
}

// Kunigal town centre. A real place, so the arithmetic below is in the units the
// shop actually operates in rather than on a unit square.
const SHOP = { lat: 13.0226, lng: 77.0295 };
const LANDMARK = { lat: 13.0316, lng: 77.0395 };

console.log('=== 1. distance arithmetic ===');
expect('a point is zero metres from itself', distanceMetres(SHOP, SHOP), 0);
// 0.001 degrees of latitude is ~111.2 m anywhere on Earth.
expectNear(
  '0.001 degrees north is ~111 m',
  distanceMetres(SHOP, { lat: SHOP.lat + 0.001, lng: SHOP.lng }),
  111.2,
  1.5,
);
// Longitude shrinks with latitude; at 13° N a degree of longitude is ~108.3 km.
expectNear(
  '0.001 degrees east is ~108 m at Kunigal latitude',
  distanceMetres(SHOP, { lat: SHOP.lat, lng: SHOP.lng + 0.001 }),
  108.3,
  1.5,
);
expectNear(
  'distance is symmetric',
  distanceMetres(SHOP, LANDMARK),
  distanceMetres(LANDMARK, SHOP),
  0.001,
);
// A shop-to-landmark hop in this town is ~1.4 km. If this ever reads as tens of
// kilometres, the units changed.
const townHop = distanceMetres(SHOP, LANDMARK);
expectTrue(
  'a real shop-to-landmark hop is between 1 and 3 km',
  townHop > 1000 && townHop < 3000,
  `got ${townHop.toFixed(1)} m`,
);

console.log('\n=== 2. rejected coordinates ===');
expect('null is not a fix', isValidFix(null), false);
expect('undefined is not a fix', isValidFix(undefined), false);
expect('NaN latitude is not a fix', isValidFix({ lat: NaN, lng: 77 }), false);
expect('0,0 is not a fix (the "location failed" value)', isValidFix({ lat: 0, lng: 0 }), false);
expect('latitude beyond 90 is not a fix', isValidFix({ lat: 91, lng: 77 }), false);
expect('longitude beyond 180 is not a fix', isValidFix({ lat: 13, lng: 181 }), false);
expect('a real Kunigal fix is a fix', isValidFix(SHOP), true);

console.log('\n=== 3. the privacy rule: no delivery, no tracking ===');
const baseInput = {
  hasActiveDelivery: true,
  isForeground: true,
  fix: SHOP,
  lastRecordedAtMs: 0,
  lastFix: { lat: 13.0, lng: 77.0 }, // ~3 km away, so "moved" is huge
  nowMs: 10 * 60_000, // ten minutes since the last write: every clock says write
};
expect(
  'an idle rider is never recorded',
  shouldRecordPosition({ ...baseInput, hasActiveDelivery: false }),
  { write: false, reason: 'no_active_delivery' },
);
// The order of checks matters: privacy must win even when every other condition
// is perfect, otherwise a future edit that reorders the checks would leak.
expect(
  'privacy is checked before the app being backgrounded',
  shouldRecordPosition({
    ...baseInput,
    hasActiveDelivery: false,
    isForeground: false,
  }).reason,
  'no_active_delivery',
);
expect(
  'privacy is checked before an invalid fix',
  shouldRecordPosition({
    ...baseInput,
    hasActiveDelivery: false,
    fix: { lat: 0, lng: 0 },
  }).reason,
  'no_active_delivery',
);

console.log('\n=== 4. the two clocks ===');
expect('backgrounded is never recorded', shouldRecordPosition({ ...baseInput, isForeground: false }).reason, 'backgrounded');
expect(
  'an invalid fix is never recorded, even when it is "time"',
  shouldRecordPosition({ ...baseInput, fix: { lat: 0, lng: 0 } }).reason,
  'invalid_fix',
);

// Moving: a fresh 200 m displacement. 30 s is past the fast clock.
expect(
  'a rider who moved 200 m and has not written for 30 s is recorded',
  shouldRecordPosition({ ...baseInput, nowMs: 30_000 }).write,
  true,
);
// Same movement, but a write happened 5 s ago: honour the throttle.
expect(
  'the same movement 5 s after a write is too soon',
  shouldRecordPosition({ ...baseInput, nowMs: 5_000 }),
  { write: false, reason: 'too_soon' },
);

// Parked: 3 m of GPS jitter.
const parked = { ...baseInput, lastFix: SHOP, fix: { lat: SHOP.lat + 0.00002, lng: SHOP.lng } }; // ~2 m
expect(
  'a parked bike writing 10 s later is refused',
  shouldRecordPosition({ ...parked, nowMs: 10_000 }),
  { write: false, reason: 'not_moved' },
);
expect(
  'a parked bike still sends a heartbeat after the slow interval',
  shouldRecordPosition({ ...parked, nowMs: STATIONARY_INTERVAL_MS }).write,
  true,
);
// The subtle one: jitter must not reset the fast clock. A parked bike reports a
// fix every 20 s, wandering 2 m. Over 200 s that must not produce ten writes.
//
// The loop keeps `lastRecordedAtMs` and `lastFix` the way the caller does — the
// first version of this test forgot to advance the write time, so the throttle
// correctly emitted heartbeats and the test blamed the rule for its own bug.
let jitterWrites = 0;
let jitterLastRecordedAt = 0;
let jitterLastFix = SHOP;
for (let i = 1; i <= 10; i += 1) {
  const nowMs = i * 20_000;
  const jitterFix = { lat: SHOP.lat + (i % 2 === 0 ? 0.00002 : 0), lng: SHOP.lng };
  const decision = shouldRecordPosition({
    hasActiveDelivery: true,
    isForeground: true,
    fix: jitterFix,
    lastRecordedAtMs: jitterLastRecordedAt,
    lastFix: jitterLastFix,
    nowMs,
  });
  if (decision.write) {
    jitterWrites += 1;
    jitterLastRecordedAt = nowMs;
    jitterLastFix = jitterFix;
  }
}
// 200 s at a 150 s parked clock means exactly one heartbeat, and the writes must
// not be ten.
expect('ten jittery fixes over 200 s produce one write, not ten', jitterWrites, 1);

// First ever fix: nothing to compare against, so it must go out immediately.
expect(
  'the first fix is recorded at once',
  shouldRecordPosition({
    hasActiveDelivery: true,
    isForeground: true,
    fix: SHOP,
    lastRecordedAtMs: null,
    lastFix: null,
    nowMs: 1_000,
  }).write,
  true,
);

console.log('\n=== 5. the same input twice gives the same answer ===');
const once = shouldRecordPosition({ ...baseInput, nowMs: 30_000 });
const twice = shouldRecordPosition({ ...baseInput, nowMs: 30_000 });
expect('the throttle is pure', twice, once);

console.log('\n=== 6. the final write when the app is backgrounded ===');
expect('no delivery means no final write either', shouldWriteOnBackground({ hasActiveDelivery: false, fix: SHOP, lastRecordedAtMs: 0, nowMs: 60_000 }), false);
expect('an invalid fix never gets a final write', shouldWriteOnBackground({ hasActiveDelivery: true, fix: { lat: 0, lng: 0 }, lastRecordedAtMs: 0, nowMs: 60_000 }), false);
expect('a stale fix gets a final write on backgrounding', shouldWriteOnBackground({ hasActiveDelivery: true, fix: SHOP, lastRecordedAtMs: 0, nowMs: 60_000 }), true);
expect('a fix written 2 s ago does not get a redundant final write', shouldWriteOnBackground({ hasActiveDelivery: true, fix: SHOP, lastRecordedAtMs: 58_000, nowMs: 60_000 }), false);

console.log('\n=== 7. staleness: a stale dot is never drawn ===');
expect('9 minutes old is showable', isPositionShowable({ recordedAtMs: 0, nowMs: 9 * 60_000 }), true);
expect('exactly 10 minutes old is still showable', isPositionShowable({ recordedAtMs: 0, nowMs: STALE_AFTER_MS }), true);
expect('10 minutes and 1 ms old is NOT showable', isPositionShowable({ recordedAtMs: 0, nowMs: STALE_AFTER_MS + 1 }), false);
expect('a fix from the future is NOT showable (clock skew)', isPositionShowable({ recordedAtMs: 10_000, nowMs: 0 }), false);
expect('no position at all is NOT showable', isPositionShowable({ recordedAtMs: null, nowMs: 0 }), false);
expect(
  'a fix too imprecise to be a place is NOT showable',
  isPositionShowable({ recordedAtMs: 0, nowMs: 1_000, accuracyM: MAX_USABLE_ACCURACY_M + 1 }),
  false,
);
expect('a good-accuracy fresh fix IS showable', isPositionShowable({ recordedAtMs: 0, nowMs: 1_000, accuracyM: 12 }), true);
// The age shown to the customer must never be negative, or Kannada reads as gibberish.
expect('age is clamped at zero for a future-dated fix', positionAgeSeconds(5_000, 1_000), 0);
expect('age is whole seconds', positionAgeSeconds(0, 45_600), 45);

console.log('\n=== 8. the ETA is a floor and a ceiling, never a negative ===');
expect('zero metres still shows the floor', etaMinutesFor(0), ETA_FLOOR_MINUTES);
expect('500 m shows the floor, not "2 min"', etaMinutesFor(500), ETA_FLOOR_MINUTES);
expect('1000 m is 4 minutes', etaMinutesFor(1000), 4);
expect('2000 m is 7 minutes', etaMinutesFor(2000), 7);
expect('a negative distance has no ETA', etaMinutesFor(-1), null);
expect('NaN has no ETA', etaMinutesFor(NaN), null);
expect('null has no ETA', etaMinutesFor(null), null);
expect(
  'the ceiling itself is allowed',
  etaMinutesFor(ETA_CEILING_MINUTES * 60 * 5.5),
  ETA_CEILING_MINUTES,
);
expect('beyond the ceiling there is no ETA at all', etaMinutesFor(ETA_CEILING_MINUTES * 60 * 5.5 + 500), null);

console.log('\n=== 9. distance as a customer reads it ===');
expect('nothing to show returns null', formatDistance(null), null);
expect('0 m reads as 50 m, not 0 m', formatDistance(0), { value: 50, unit: 'm' });
expect('47 m rounds to 50 m', formatDistance(47), { value: 50, unit: 'm' });
expect('124 m rounds to 100 m', formatDistance(124), { value: 100, unit: 'm' });
expect('999 m becomes 1 km, never "1000 m"', formatDistance(999), { value: 1, unit: 'km' });
expect('1240 m reads as 1.2 km', formatDistance(1240), { value: 1.2, unit: 'km' });
expect('15000 m reads as 15 km', formatDistance(15000), { value: 15, unit: 'km' });

console.log('\n=== 10. arriving ===');
expect('60 m away counts as arrived', hasArrived(ARRIVED_METRES), true);
expect('61 m away is still on the way', hasArrived(ARRIVED_METRES + 1), false);
expect('no distance is not arrived', hasArrived(null), false);

console.log('\n=== 11. the constants still have the shape the design assumes ===');
expectTrue(
  'the parked clock is slower than the moving clock',
  STATIONARY_INTERVAL_MS > MOVING_INTERVAL_MS * 3,
  `moving ${MOVING_INTERVAL_MS} ms, parked ${STATIONARY_INTERVAL_MS} ms`,
);
expectTrue(
  'a position goes stale long before a parked heartbeat would stop it being trusted',
  STALE_AFTER_MS > STATIONARY_INTERVAL_MS,
  `stale ${STALE_AFTER_MS} ms, heartbeat ${STATIONARY_INTERVAL_MS} ms`,
);
expectTrue(
  'GPS jitter is below the movement threshold',
  MIN_MOVED_METRES > 10,
  `threshold ${MIN_MOVED_METRES} m — a parked bike jitters 5–15 m`,
);

console.log(
  failures === 0
    ? '\nRESULT: all checks passed'
    : `\nRESULT: ${failures} check(s) failed`,
);
process.exit(failures === 0 ? 0 : 1);
