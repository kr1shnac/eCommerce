#!/usr/bin/env node
/**
 * check-unit-price.mjs — the rate behind the pack: ₹/kg and ₹/l (register A2).
 *
 * Run:  npm run check:unit-price
 *
 * WHY THIS EXISTS
 *
 * The shop sells the same thing in more than one packet. A 500 g bag of rice at
 * ₹32 and a 1 kg bag at ₹60 do not tell a customer which is cheaper; a rate does
 * (₹64/kg against ₹60/kg). The rivals publish `pricePerUom` for exactly this, and
 * it is the one honest way to compare two packs on the same shelf without asking
 * a shopper to do division in their head while holding a bag.
 *
 * WHERE THE LINE IS
 *
 * `lib/pack.ts` is weight and volume only, and `check:packs` asserts that it never
 * touches money — that separation is what stopped the register-M4 mistake of a
 * fractional quantity. The paise conversion therefore lives in `lib/unit-price.ts`
 * and is checked here, the same way. The result is always an **integer number of
 * paise**, rounded exactly once; nothing in that module formats a price.
 *
 * WHAT IT PROVES
 *
 *   1. Grams and kilograms land on the same rate, so 500 g and 1 kg of the same
 *      thing never disagree by a factor of 1000.
 *   2. Millilitres and litres do the same, on their own scale.
 *   3. A piece product has no rate — null, never a made-up "per kg of soap".
 *   4. A missing, zero or negative pack returns null rather than dividing by zero.
 *   5. The rate is always a whole number of paise, rounded once at the end.
 *   6. The module never imports a money formatter and never converts to rupees.
 *
 * What this does NOT prove: that the rate looks right on a phone, or that the
 * shop's own pack sizes are described correctly in the database. The latter is
 * asserted in `supabase/tests/21_pack_sizes_test.sql`.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const { unitRatePaise } = await import(
  pathToFileURL(join(root, 'apps/mobile/src/lib/unit-price.ts')).href
);

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

console.log('=== 1. weight is quoted per kilogram ===');
// ₹32 for 500 g is ₹64 a kilo. The customer sees the 64, not the 32, because
// that is the number that compares across two packs.
expect('500 g at ₹32.00 is ₹64.00/kg', unitRatePaise(3200, 500, 'g'), {
  paise: 6400,
  unit: 'kg',
});
expect('1 kg at ₹60.00 is ₹60.00/kg', unitRatePaise(6000, 1, 'kg'), {
  paise: 6000,
  unit: 'kg',
});
expect('1.5 kg at ₹150.00 is ₹100.00/kg', unitRatePaise(15000, 1.5, 'kg'), {
  paise: 10000,
  unit: 'kg',
});
expect('5 kg at ₹450.00 is ₹90.00/kg', unitRatePaise(45000, 5, 'kg'), {
  paise: 9000,
  unit: 'kg',
});
expect('100 g at ₹9.00 is ₹90.00/kg', unitRatePaise(900, 100, 'g'), {
  paise: 9000,
  unit: 'kg',
});

console.log('\n=== 2. the same thing at two sizes gives the same rate ===');
// The whole point: if the shop prices a kilo honestly, both packs must agree.
const halfKilo = unitRatePaise(3200, 500, 'g');
const oneKilo = unitRatePaise(6400, 1, 'kg');
expectTrue('500 g at ₹32 and 1 kg at ₹64 share one rate', halfKilo.paise === oneKilo.paise);

console.log('\n=== 3. liquids are their own scale ===');
expect('750 ml at ₹90.00 is ₹120.00/l', unitRatePaise(9000, 750, 'ml'), {
  paise: 12000,
  unit: 'l',
});
expect('1 l at ₹120.00 is ₹120.00/l', unitRatePaise(12000, 1, 'l'), {
  paise: 12000,
  unit: 'l',
});
expect('500 ml at ₹60.00 is ₹120.00/l', unitRatePaise(6000, 500, 'ml'), {
  paise: 12000,
  unit: 'l',
});
// 500 ml must never be quoted per kilogram: milk is not rice.
expectTrue('millilitres quote litres, never kilograms', unitRatePaise(6000, 500, 'ml').unit === 'l');

console.log('\n=== 4. a piece product has no rate ===');
// "₹30 per kg of soap" is not a number a shopkeeper would ever say, so the screen
// must get null and render nothing rather than a confident absurdity.
expect('a piece pack is null', unitRatePaise(3000, 1, 'piece'), null);
expect('a piece pack with no size is null', unitRatePaise(3000, null, 'piece'), null);

console.log('\n=== 5. nothing divides by zero or invents a rate ===');
expect('no pack size is null', unitRatePaise(3000, null, 'kg'), null);
expect('no pack unit is null', unitRatePaise(3000, 1, null), null);
expect('a zero pack size is null', unitRatePaise(3000, 0, 'kg'), null);
expect('a negative pack size is null', unitRatePaise(3000, -1, 'kg'), null);
expect('a NaN pack size is null', unitRatePaise(3000, NaN, 'kg'), null);
expect('an infinite pack size is null', unitRatePaise(3000, Infinity, 'kg'), null);
expect('a missing price is null', unitRatePaise(null, 1, 'kg'), null);
expect('an undefined price is null', unitRatePaise(undefined, 1, 'kg'), null);
expect('a NaN price is null', unitRatePaise(NaN, 1, 'kg'), null);
expect('a negative price is null', unitRatePaise(-100, 1, 'kg'), null);

console.log('\n=== 6. a free item is a real zero, not a missing rate ===');
// A shop may genuinely give something away (a sample sachet). That is ₹0.00/kg,
// which is different from "cannot be compared" — null is reserved for the latter.
expect('a zero price is ₹0.00/kg', unitRatePaise(0, 500, 'g'), { paise: 0, unit: 'kg' });

console.log('\n=== 7. paise is rounded exactly once, and stays an integer ===');
// 3 paise for 7 g is 428.571... paise/kg. One rounding, at the end: 429.
expect('3 paise for 7 g rounds once to 429', unitRatePaise(3, 7, 'g'), {
  paise: 429,
  unit: 'kg',
});
expectTrue(
  'every weight rate is a whole number of paise',
  Number.isInteger(unitRatePaise(1234, 7, 'g').paise),
);
expectTrue(
  'every liquid rate is a whole number of paise',
  Number.isInteger(unitRatePaise(1234, 7, 'ml').paise),
);
expectTrue(
  'the rate never carries float noise (no .0000001)',
  Number.isInteger(unitRatePaise(999, 3, 'kg').paise),
);

console.log('\n=== 8. the module formats nothing and never speaks rupees ===');
// Money becomes a string in exactly one place (`lib/money.ts`), at the UI edge.
// If this module ever gains a formatter, this is the assertion that stops it.
const source = readFileSync(join(root, 'apps/mobile/src/lib/unit-price.ts'), 'utf8');
const codeOnly = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
expectTrue('it imports no money helper', !/from '@\/lib\/money'/.test(codeOnly));
expectTrue('it contains no formatPaise', !/formatPaise/.test(codeOnly));
expectTrue('it contains no toFixed', !/toFixed/.test(codeOnly));
expectTrue('it never divides paise by 100', !/\/\s*100\b/.test(codeOnly));

console.log(`\n${failures === 0 ? 'RESULT: all checks passed' : `RESULT: ${failures} FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
