#!/usr/bin/env node
/**
 * check-order-view.mjs — the address and time helpers three screens share.
 *
 * Run:  npm run check:view
 *
 * WHY THIS EXISTS
 *
 * `apps/mobile/src/lib/order-view.ts` is imported by the **rider's** screen, the
 * **owner's** board and the **customer's** order screen, and until now nothing
 * tested it at all. It is the only thing standing between an order's raw
 * `delivery_address` jsonb and what a rider reads while standing on a bike. A
 * bug here is not a crash — it is a rider sent to the wrong house, which is
 * exactly the kind of silent failure that no stack trace ever reports.
 *
 * It is pure logic (no React, no network), so it can be tested honestly from
 * Node without a device. That is why this check exists where the rest of the UI
 * cannot have one.
 *
 * WHAT IT PROVES
 *
 *   1. `readSnapshotAddress` survives everything a jsonb column can actually
 *      hold: an object, null, a string, an array, a number. A snapshot column is
 *      `Record<string, unknown>` — it is not trusted, and a rider screen that
 *      throws on a malformed row shows nothing at all.
 *   2. `formatSnapshotAddress` skips empty parts and never leaves a stray ", ,"
 *      or a trailing comma. An address with only `line1` must not render as
 *      "Main Road, , , 572130".
 *   3. `splitSnapshotAddress` puts the landmark FIRST — the rider change — and
 *      keeps everything else in `rest`, with no part lost between the two.
 *   4. `hasLandmark` is false for null, empty and whitespace-only, so the rider
 *      card falls back to the plain sentence instead of an empty heading.
 *   5. `dialablePhone` refuses a number too short to call, and strips the
 *      punctuation a customer types, so the `tel:` link is always dialable.
 *   6. `formatClock` and `minutesSince` are the shared time helpers; the clock is
 *      24-hour day/month as Kunigal reads it, and minutes are never negative.
 *   7. `isSameDay` compares LOCAL calendar days, which is what "today's takings"
 *      depends on.
 *
 * What this does NOT prove: that the screens using these helpers render
 * correctly. Only a device run does that (PRODUCTION.md §5).
 *
 * Run: node --import ./scripts/node-hooks/register.mjs ./scripts/check-order-view.mjs
 * (that is what `npm run check:view` does)
 */
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const MODULE = pathToFileURL(join(root, 'apps/mobile/src/lib/order-view.ts')).href;

const {
  readSnapshotAddress,
  formatSnapshotAddress,
  splitSnapshotAddress,
  hasLandmark,
  dialablePhone,
  formatClock,
  minutesSince,
  isSameDay,
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
function expectTrue(name, ok) {
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
}

console.log('=== 1. readSnapshotAddress tolerates whatever the column holds ===');
expect('a well-formed object comes back as-is', readSnapshotAddress({
  delivery_address: { line1: 'Main Road', landmark: 'the temple' },
}), { line1: 'Main Road', landmark: 'the temple' });

expect('null becomes an empty object, not null', readSnapshotAddress({ delivery_address: null }), {});
expect('undefined becomes an empty object', readSnapshotAddress({ delivery_address: undefined }), {});
expect('a string becomes an empty object', readSnapshotAddress({ delivery_address: 'oops' }), {});
expect('a number becomes an empty object', readSnapshotAddress({ delivery_address: 42 }), {});
// An array IS an object in JS. The point is that it does not throw; the screens
// read named fields, and a named field on an array is simply undefined.
expectTrue('an array does not throw', Array.isArray(readSnapshotAddress({ delivery_address: [] })));
// The customer screen passes the loosened shape: an order with items, or a
// stand-in when the query has not resolved. Both must be accepted — this is the
// assertion that would catch the parameter being tightened back to `Pick<Order>`.
expect('a widened row with extra fields still reads', readSnapshotAddress({
  delivery_address: { line1: 'Main Road' },
  order_items: [{ id: 'x' }],
  total_paise: 4900,
}), { line1: 'Main Road' });
expect('an absent column is an empty object', readSnapshotAddress({ }), {});

console.log('\n=== 2. formatSnapshotAddress never leaves a stray comma ===');
expect('a full address reads as one sentence', formatSnapshotAddress({
  line1: 'No. 12', line2: 'Main Road', landmark: 'the temple',
  city: 'Kunigal', pincode: '572130',
}), 'No. 12, Main Road, Near the temple, Kunigal 572130');

// The common real case: the customer filled in the minimum. This is the one that
// would produce "Main Road, , , 572130" if the join were naive.
expect('line1 only', formatSnapshotAddress({ line1: 'Main Road' }), 'Main Road');
expect('line1 and pincode', formatSnapshotAddress({
  line1: 'Main Road', city: 'Kunigal', pincode: '572130',
}), 'Main Road, Kunigal 572130');
expect('no landmark, no gap left behind', formatSnapshotAddress({
  line1: 'Main Road', line2: '2nd cross', city: 'Kunigal', pincode: '572130',
}), 'Main Road, 2nd cross, Kunigal 572130');
expect('an empty object formats to an empty string', formatSnapshotAddress({}), '');
expect('a custom near-word is used', formatSnapshotAddress(
  { line1: 'A', landmark: 'B' }, 'ಹತ್ತಿರ',
), 'A, ಹತ್ತಿರ B');

console.log('\n=== 3. splitSnapshotAddress leads with the landmark ===');
// This is the rider change: the landmark is the instruction, not a detail.
expect('the landmark is pulled out and the rest kept', splitSnapshotAddress({
  line1: 'No. 12', line2: 'Main Road', landmark: 'the big banyan tree',
  city: 'Kunigal', pincode: '572130',
}), { landmark: 'the big banyan tree', rest: 'No. 12, Main Road, Kunigal 572130' });

// Nothing may be lost between the two halves — this is the assertion that would
// catch a future edit dropping a line.
expect('no part is lost: landmark + rest covers every field', (() => {
  const a = { line1: 'L1', line2: 'L2', landmark: 'LM', city: 'C', pincode: 'P' };
  const { landmark, rest } = splitSnapshotAddress(a);
  return [landmark, rest].join(' | ');
})(), 'LM | L1, L2, C P');

expect('with no landmark, rest is the whole address', splitSnapshotAddress({
  line1: 'Main Road', city: 'Kunigal', pincode: '572130',
}), { landmark: null, rest: 'Main Road, Kunigal 572130' });
expect('whitespace-only landmark counts as none', splitSnapshotAddress({
  line1: 'A', landmark: '   ',
}), { landmark: null, rest: 'A' });
expect('an empty object gives both halves empty', splitSnapshotAddress({}), { landmark: null, rest: '' });

console.log('\n=== 4. hasLandmark decides the rider fallback ===');
expectTrue('a real landmark is true', hasLandmark({ landmark: 'the temple' }));
expectTrue('null is false', hasLandmark({ landmark: null }) === false);
expectTrue('undefined is false', hasLandmark({}) === false);
expectTrue('empty string is false', hasLandmark({ landmark: '' }) === false);
expectTrue('whitespace only is false', hasLandmark({ landmark: '  \n ' }) === false);

console.log('\n=== 5. dialablePhone only returns something you can actually call ===');
expect('a plain 10-digit number', dialablePhone('9876543210'), '9876543210');
expect('a +91 number is stripped to digits', dialablePhone('+91 98765 43210'), '919876543210');
expect('spaces and dashes are removed', dialablePhone('98765-43210'), '9876543210');
expect('a number with a leading zero', dialablePhone('09876543210'), '09876543210');
expect('too short is refused', dialablePhone('12345'), null);
expect('null is refused', dialablePhone(null), null);
expect('undefined is refused', dialablePhone(undefined), null);
expect('empty is refused', dialablePhone(''), null);
// A string of punctuation has no digits, so it is refused rather than dialled.
expect('punctuation only is refused', dialablePhone('---'), null);

console.log('\n=== 6. the shared time helpers ===');
// 24-hour, day/month — read the same in both languages (see the module comment).
// Built from local parts so the assertion does not depend on the machine's zone.
const sample = new Date(2026, 9, 25, 21, 5, 0); // 25 Oct 2026, 21:05 local
expect('the clock is 24-hour day/month', formatClock(sample.toISOString()), '25/10, 21:05');
expect('a single-digit month is padded', formatClock(new Date(2026, 0, 3, 9, 7).toISOString()), '03/01, 09:07');
expect('null is empty', formatClock(null), '');
expect('undefined is empty', formatClock(undefined), '');
expect('an unparseable string is empty, not "NaN/NaN"', formatClock('not a date'), '');

const twoMinutesAgo = new Date(Date.now() - 2 * 60_000).toISOString();
expectTrue('minutesSince is about 2', Math.abs(minutesSince(twoMinutesAgo) - 2) <= 1);
// A clock skewed into the future must not report "waiting -5 minutes".
expectTrue('a future timestamp never goes negative', minutesSince(
  new Date(Date.now() + 60 * 60_000).toISOString(),
) === 0);
expect('null is 0', minutesSince(null), 0);
expect('unparseable is 0', minutesSince('nope'), 0);

console.log('\n=== 7. isSameDay compares LOCAL calendar days ===');
const today = new Date(2026, 9, 25, 14, 0, 0);
const todayMorning = new Date(2026, 9, 25, 6, 30, 0);
const yesterday = new Date(2026, 9, 24, 23, 59, 0);
const tomorrow = new Date(2026, 9, 26, 0, 1, 0);
expectTrue('morning and afternoon of the same day', isSameDay(todayMorning.toISOString(), today));
// The two that matter: an order at 23:59 is yesterday, one at 00:01 is tomorrow.
// A UTC comparison would put them on the wrong side of the day boundary.
expectTrue('23:59 yesterday is not today', isSameDay(yesterday.toISOString(), today) === false);
expectTrue('00:01 tomorrow is not today', isSameDay(tomorrow.toISOString(), today) === false);
expectTrue('null is not today', isSameDay(null, today) === false);
expectTrue('undefined is not today', isSameDay(undefined, today) === false);
expectTrue('unparseable is not today', isSameDay('nope', today) === false);

console.log(`\n${failures === 0 ? 'RESULT: all checks passed' : `RESULT: ${failures} FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
