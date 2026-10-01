#!/usr/bin/env node
/**
 * check-query-persistence.mjs — what the app is allowed to write to the device.
 *
 * Run:  npm run check:persist
 *
 * WHY THIS EXISTS
 *
 * Register M1 made the catalogue survive closing the app: React Query's cache is
 * now written to `AsyncStorage` and hydrated on the next cold start, so a customer
 * opening the app in a dead spot sees the shelves instead of a spinner.
 *
 * `AsyncStorage` is a plain file on the phone. It is readable on a rooted device,
 * survives with the app, and — importantly — is **not** wiped by signing out unless
 * something wipes it. So `shouldPersistQuery()` decides what may be written to that
 * file, and it is the only thing standing between "the shop's price list" and "a
 * customer's home address in a plain file on a shared phone". A mistake here is a
 * privacy incident, not a slow screen. It is ~1 line of logic with a very high
 * cost of being wrong, which is exactly what deserves a test.
 *
 * The rule is an ALLOWLIST on the query key's root. That is the design decision
 * being pinned here: a denylist would fail open — the day somebody adds a
 * `useSomethingSensitive` hook, its data is silently persisted and nobody notices.
 * An allowlist fails closed: a new key is simply not cached, and the worst case is
 * a slower first screen.
 *
 * WHAT IT PROVES
 *
 *   1. The three public catalogue roots ARE persisted — because persisting none of
 *      them would make the feature do nothing at all.
 *   2. Every personal or staff root is NOT persisted, enumerated by name, so the
 *      exclusions are visible and argued rather than implied.
 *   3. A key that is not on the list fails **closed**. This is the assertion that
 *      encodes the design: a brand-new query key is not persisted by default.
 *   4. Malformed keys (empty, a number, a null, an object, an absent key) do not
 *      throw and do not persist. A crash here would take the app down on launch.
 *
 * What this does NOT prove: that `PersistQueryClientProvider` is actually wired
 * into the root layout, or that the cache round-trips through real `AsyncStorage`.
 * Those need a device (PRODUCTION.md §5).
 *
 * Run: node --import ./scripts/node-hooks/register.mjs ./scripts/check-query-persistence.mjs
 */
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const MODULE = pathToFileURL(join(root, 'apps/mobile/src/lib/query-persistence.ts')).href;

const { shouldPersistQuery } = await import(MODULE);

let failures = 0;
function check(name, ok, detail = '') {
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok && detail) console.log(`        ${detail}`);
}

/** Shorthand: build the minimal query shape the function actually reads. */
const k = (queryKey) => ({ queryKey });

console.log('=== 1. the public catalogue IS persisted (or the feature is a no-op) ===');
// These are the exact keys from `src/hooks/use-catalog.ts`. If these are not
// persisted, M1 was not delivered regardless of what else passes.
check('categories', shouldPersistQuery(k(['categories'])));
check('products, all', shouldPersistQuery(k(['products', 'all'])));
check('products, one category', shouldPersistQuery(k(['products', 'cat-uuid'])));
check('product, one id', shouldPersistQuery(k(['product', 'prod-uuid'])));
check('product, the "none" placeholder', shouldPersistQuery(k(['product', 'none'])));

console.log('\n=== 2. nothing personal is written to a plain file ===');
// Each of these is named deliberately. If somebody adds one to PERSISTED_ROOTS to
// "make it faster", this test fails and the reason is written down right here.
const FORBIDDEN = [
  ['orders', 'a customer\'s order history'],
  ['order', 'one order — carries the delivery_address snapshot'],
  ['addresses', 'where the customer lives'],
  ['address', 'one saved address'],
  ['profile', 'name, phone, role'],
  ['rider', 'the rider pool — a list of addresses on a lost phone'],
  ['rider-directory', 'other people\'s phone numbers'],
  ['shelf', 'staff-only price/stock view'],
  ['shop-totals', 'the shop\'s takings — staff only'],
  ['coupons', 'shop-internal'],
  ['cart-products', 'the basket, derived from the customer\'s own actions'],
];
for (const [key, why] of FORBIDDEN) {
  check(`NOT persisted: ${key} (${why})`, shouldPersistQuery(k([key])) === false);
}

console.log('\n=== 3. an unknown key fails CLOSED — this is the design ===');
// The whole point of an allowlist. A future `useLoyaltyPoints()` added by someone
// who never read this file must be excluded automatically.
check('a never-seen key is not persisted', shouldPersistQuery(k(['loyalty-points'])) === false);
check('a key that merely starts like an allowed one', shouldPersistQuery(k(['products-secret'])) === false);
check('a key with the allowed word as a second element', shouldPersistQuery(k(['x', 'products'])) === false);
// A nested/subkey shape must not sneak through either.
check('a nested array as the root', shouldPersistQuery(k([['products']])) === false);

console.log('\n=== 4. a malformed key cannot crash the app on launch ===');
// This runs during hydration, before the first paint. A throw here is an app that
// does not open, which is the worst possible failure for the feature to introduce.
const MALFORMED = [
  ['an empty key', []],
  ['a null first element', [null]],
  ['a number first element', [1]],
  ['an object first element', [{ root: 'products' }]],
  ['a boolean first element', [true]],
  ['a function first element', [() => 'products']],
];
for (const [name, key] of MALFORMED) {
  let threw = false;
  let result = null;
  try {
    result = shouldPersistQuery(k(key));
  } catch {
    threw = true;
  }
  check(`${name} does not throw and does not persist`, threw === false && result === false);
}

// The React Query contract is that `queryKey` is always present, but this function
// is called from a serialisation path where a defensive read costs nothing.
let missingThrew = false;
let missingResult = null;
try {
  missingResult = shouldPersistQuery({});
} catch {
  missingThrew = true;
}
check('a query with no key at all does not throw', missingThrew === false && missingResult === false);

console.log(`\n${failures === 0 ? 'RESULT: all checks passed' : `RESULT: ${failures} FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
