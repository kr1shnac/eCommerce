#!/usr/bin/env node
/**
 * check-saved.mjs — the "save for later" shelf cannot overlap the bag.
 *
 * Run:  npm run check:saved
 *
 * WHY THIS EXISTS
 *
 * Two lists that overlap are the one silent money bug in a shopping screen: an
 * item counted in both the basket and the saved shelf is an item the customer
 * believes they are not buying. Nothing crashes, nothing logs, and the shop
 * finds out when the order arrives with a packet nobody wanted. So the rules
 * that keep the two lists apart are pure functions in
 * `apps/mobile/src/lib/saved-later.ts`, and this is their test.
 *
 * WHAT IT PROVES
 *
 *   1. One product query serves BOTH lists, as one sorted id set — because the
 *      query key is a string, and an unsorted key refetches forever on a
 *      patchy connection.
 *   2. Moving saved items back TOPS UP the bag instead of overwriting it:
 *      saving 2 onions and keeping 3 means 5, not 2.
 *   3. A full bag does not silently drop a saved item — the overflow stays on
 *      the shelf, because losing a customer's item is worse than refusing it.
 *   4. A corrupted quantity (NaN, a fraction, a zero, a 99.5) never enters the
 *      bag.
 *   5. A half-written device file degrades to an empty shelf, not a crash on
 *      launch — the same rule `readSnapshotAddress` follows.
 *
 * What this does NOT prove: that the buttons do the right thing on a screen.
 * Only a device run does that (PRODUCTION.md §5).
 */
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const MODULE = pathToFileURL(join(root, 'apps/mobile/src/lib/saved-later.ts')).href;
const CART = pathToFileURL(join(root, 'apps/mobile/src/store/cart-store.ts')).href;

const { productIdsFor, mergeIntoCart, isKeepableQuantity, usableSaved } = await import(MODULE);
const { MAX_LINES } = await import(CART);

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
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `\n        ${detail ?? ''}`}`);
}

console.log('=== 1. one query, one key, both lists ===');
expect('the id set is the union of the two lists', productIdsFor({ b: 1 }, { a: 2, c: 3 }), ['a', 'b', 'c']);
expect('an id in both lists appears once', productIdsFor({ a: 1 }, { a: 2 }), ['a']);
expect('the key is sorted, so it is a stable string', productIdsFor({ c: 1, a: 2 }, {}), ['a', 'c']);
expect('two empty lists make no query at all', productIdsFor({}, {}), []);
expectTrue(
  'a key built twice from the same maps is identical',
  productIdsFor({ a: 1 }, { b: 2 }).join(',') === productIdsFor({ a: 1 }, { b: 2 }).join(','),
);

console.log('\n=== 2. moving back tops up, it does not overwrite ===');
expect('3 in the bag + 2 saved = 5', mergeIntoCart({ onion: 2 }, { onion: 3 }), { onion: 5 });
expect('a disjoint saved line joins the bag', mergeIntoCart({ rice: 1 }, { onion: 3 }), { onion: 3, rice: 1 });
expect('an empty shelf leaves the bag exactly as it was', mergeIntoCart({}, { onion: 3 }), { onion: 3 });
expect('an empty bag takes the whole shelf', mergeIntoCart({ rice: 1, dal: 2 }, {}), { rice: 1, dal: 2 });
expect('the original bag object is not mutated', (() => {
  const bag = { onion: 3 };
  mergeIntoCart({ rice: 1 }, bag);
  return bag;
})(), { onion: 3 });

console.log('\n=== 3. a full bag keeps the overflow on the shelf ===');
// MAX_LINES is the cart's cap. A customer with a full bag who saves ten more
// items and then moves them all back must not lose the last ones.
const fullBag = Object.fromEntries(Array.from({ length: MAX_LINES }, (_, i) => [`p${i}`, 1]));
const overflow = mergeIntoCart({ spare1: 1, spare2: 2 }, fullBag);
expect('a full bag keeps all its own lines', Object.keys(overflow).length, MAX_LINES);
expectTrue('the first spare is refused a place in a full bag', overflow.spare1 === undefined,
  `got ${JSON.stringify(overflow.spare1)}`);
expectTrue('and so is the second', overflow.spare2 === undefined);
// Now with one line short of full: the new line DOES join, and the existing
// line is topped up.
const nearlyFull = { ...fullBag };
delete nearlyFull[`p${MAX_LINES - 1}`];
const oneSpare = mergeIntoCart({ p0: 2, spare1: 1 }, nearlyFull);
expect('one line short: a new saved line joins', oneSpare.spare1, 1);
expect('and the line already in the bag is topped up', oneSpare.p0, 3);

console.log('\n=== 4. a corrupted quantity never enters the bag ===');
expect('NaN is refused', mergeIntoCart({ a: Number.NaN }, {}), {});
expect('a fraction is floored, not rounded into the bag', mergeIntoCart({ a: 2.9 }, {}), { a: 2 });
expect('zero is refused', mergeIntoCart({ a: 0 }, {}), {});
expect('a negative is refused', mergeIntoCart({ a: -3 }, {}), {});
expect('Infinity is refused', mergeIntoCart({ a: Number.POSITIVE_INFINITY }, {}), {});
expectTrue('1 is keepable', isKeepableQuantity(1));
expectTrue('99 is keepable', isKeepableQuantity(99));
expectTrue('100 is not', !isKeepableQuantity(100));
expectTrue('a fraction is not', !isKeepableQuantity(2.5));
expectTrue('a string is not', !isKeepableQuantity('2'));
expectTrue('null is not', !isKeepableQuantity(null));

console.log('\n=== 5. a half-written device file degrades to an empty shelf ===');
expect('null is an empty shelf', usableSaved(null), {});
expect('a string is an empty shelf', usableSaved('oops'), {});
expect('a number is an empty shelf', usableSaved(42), {});
expect('an array is an empty shelf', usableSaved(['a']), {});
expect('a good file is kept as-is', usableSaved({ rice: 1, dal: 2 }), { rice: 1, dal: 2 });
expect('a corrupt entry is dropped, the good one kept', usableSaved({ rice: 1, bad: 'x' }), { rice: 1 });
expect('a zero entry is dropped', usableSaved({ rice: 0 }), {});
const capped = Object.fromEntries(
  Array.from({ length: MAX_LINES + 40 }, (_, i) => [`p${i}`, 1]),
);
expectTrue(
  `an absurd file is capped at the cart's ${MAX_LINES} lines`,
  Object.keys(usableSaved(capped)).length === MAX_LINES,
);

console.log(`\n${failures === 0 ? 'RESULT: all checks passed' : `RESULT: ${failures} FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
