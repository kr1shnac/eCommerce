#!/usr/bin/env node
/**
 * check-packs.mjs — pack sizes, and the arithmetic that must never round money.
 *
 * Run:  npm run check:packs
 *
 * WHY THIS EXISTS
 *
 * Register M4 is "loose weights cannot be sold". The tempting fix — make
 * `quantity` a numeric so a customer can buy 0.5 kg — was rejected, because
 * `order_items.line_total_paise` is `generated always as (price_paise * quantity)`
 * and a fractional quantity makes the paise fractional. Two roundings (line
 * totals and the order total) that can disagree by one paisa, intermittently, is
 * exactly the bug integer paise exists to prevent. The database test
 * (`supabase/tests/21_pack_sizes_test.sql`) proves the schema still refuses it.
 *
 * This file proves the OTHER half: the app expresses "500 g of rice" as a pack,
 * and the pack arithmetic it shows a customer is correct. `formatLineSize` is the
 * line a customer reads — "1.5 kg" — and it is pure arithmetic, so it can be
 * checked honestly here rather than by squinting at a phone.
 *
 * WHAT IT PROVES
 *
 *   1. Grams and kilograms normalise onto ONE scale, so sizes can be compared at
 *      all. A 500 g pack and a 1 kg pack must be 500 and 1000, not 500 and 1.
 *   2. Three 500 g packets is 1.5 kg, not "1500 g" and not 0.0015 t — the number
 *      a shopkeeper would actually say.
 *   3. Millilitres and litres behave the same way, as their own scale.
 *   4. A piece product has no weight, and reports null rather than a fake 0 — so a
 *      screen renders nothing instead of "0 kg" next to three soaps.
 *   5. No float noise: 500 g × 3 must be exactly 1.5, never 1.4999999999999998.
 *   6. A product the shop has NOT described structurally falls back to its
 *      free-text unit, so nothing regresses for shelves this feature has not
 *      touched.
 *   7. No paise is involved anywhere. This is weight and volume only.
 *
 * What this does NOT prove: that the pack chips look right on a phone, or that the
 * backfill produced sensible packs for the real seed — the latter is asserted in
 * `supabase/tests/21_pack_sizes_test.sql`, against real PostgreSQL.
 */
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const {
  packInBase,
  baseUnitFor,
  lineBaseQuantity,
  formatLineSize,
  trimNumber,
  offersPackAlternatives,
  packLabel,
  asSoldBy,
} = await import(pathToFileURL(join(root, 'apps/mobile/src/lib/pack.ts')).href);

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

console.log('=== 1. grams and kilograms share one scale ===');
// This is what makes "also in 1 kg" possible at all: without a common scale the
// app cannot tell that 500 g is smaller than 1 kg.
expect('500 g normalises to 500', packInBase(500, 'g'), 500);
expect('1 kg normalises to 1000, not 1', packInBase(1, 'kg'), 1000);
expect('5 kg normalises to 5000', packInBase(5, 'kg'), 5000);
expect('a 1.5 kg pack is exactly 1500 g', packInBase(1.5, 'kg'), 1500);
// And no float noise on the multiply.
expectTrue('1.5 kg has no float error', packInBase(1.5, 'kg') === 1500);
expect('the base unit for both is grams', [baseUnitFor('g'), baseUnitFor('kg')], ['g', 'g']);

console.log('\n=== 2. millilitres and litres are their own scale ===');
// ml and l must NOT be merged with g and kg: 500 ml of milk is not 500 g of rice.
expect('500 ml normalises to 500', packInBase(500, 'ml'), 500);
expect('1 l normalises to 1000', packInBase(1, 'l'), 1000);
expect('the base unit for both is millilitres', [baseUnitFor('ml'), baseUnitFor('l')], ['ml', 'ml']);

console.log('\n=== 3. a line of three packs is said the way a shopkeeper says it ===');
// The number the customer actually reads. "1.5 kg" is what is said out loud;
// "1500 g" is not, and "0.0015 t" would be absurd.
expect('three 500 g packets', formatLineSize(500, 'g', 3), '1.5 kg');
expect('one 500 g packet stays small', formatLineSize(500, 'g', 1), '500 g');
expect('two 250 g packets', formatLineSize(250, 'g', 2), '500 g');
expect('four 250 g packets', formatLineSize(250, 'g', 4), '1 kg');
expect('one 1 kg pack', formatLineSize(1, 'kg', 1), '1 kg');
expect('three 1 kg packs', formatLineSize(1, 'kg', 3), '3 kg');
expect('two 100 g packs', formatLineSize(100, 'g', 2), '200 g');
expect('exactly one kilo is "1 kg", not "1.0 kg"', formatLineSize(500, 'g', 2), '1 kg');

console.log('\n=== 4. liquids behave the same way ===');
expect('two 500 ml bottles', formatLineSize(500, 'ml', 2), '1 l');
expect('one 500 ml bottle stays small', formatLineSize(500, 'ml', 1), '500 ml');
expect('three 750 ml bottles', formatLineSize(750, 'ml', 3), '2.25 l');
expect('one 1 l bottle', formatLineSize(1, 'l', 1), '1 l');

console.log('\n=== 5. a piece product has no weight — and says so by saying nothing ===');
// "0 kg" next to three soaps would be a lie, and null is how the screen knows to
// render nothing at all.
expect('a piece pack with no size is null', formatLineSize(null, null, 3), null);
expect('a piece pack with no unit is null', formatLineSize(1, null, 3), null);
expect('lineBaseQuantity is null for a piece product', lineBaseQuantity(null, null, 5), null);
expect('packInBase is null with no unit', packInBase(500, null), null);
expect('packInBase is null with no size', packInBase(null, 'g'), null);
// And the number itself, separate from the label.
expect('three 500 g packets are 1500 base units', lineBaseQuantity(500, 'g', 3), 1500);

console.log('\n=== 6. no float noise can reach the screen ===');
// The classic failure: 0.1 + 0.2 style noise leaking into a customer's screen.
expectTrue('2.25 l is exact, not 2.2500000000000004', formatLineSize(750, 'ml', 3) === '2.25 l');
expectTrue('1.5 kg is exact, not 1.4999999999999998', formatLineSize(500, 'g', 3) === '1.5 kg');
expect('trimNumber drops trailing zeros', trimNumber(1.0), '1');
expect('trimNumber keeps a real fraction', trimNumber(1.5), '1.5');
expect('trimNumber rounds to three places', trimNumber(1.0005), '1.001');
expectTrue('trimNumber never emits NaN', !trimNumber(NaN).includes('NaN'));
expectTrue('trimNumber never emits Infinity', !trimNumber(Infinity).includes('Infinity'));

console.log('\n=== 7. the fallback keeps an undescribed shelf exactly as it was ===');
// A product the shop has not described structurally must show its free-text unit,
// so this feature changes nothing for shelves it has not touched.
const pieceSoap = { sold_by: 'piece', pack_size: null, pack_unit: null, unit: '1 piece' };
expect('a piece product shows its free-text unit', packLabel(pieceSoap), '1 piece');
const measureRice = { sold_by: 'measure', pack_size: 1, pack_unit: 'kg', unit: '1 kg' };
expect('a measure product shows its structured pack', packLabel(measureRice), '1 kg');
// A half-declared product must not print "null g".
const halfDeclared = { sold_by: 'measure', pack_size: null, pack_unit: null, unit: '1 kg' };
expect('a half-declared measure product falls back rather than printing null',
  packLabel(halfDeclared), '1 kg');

console.log('\n=== 8. alternatives are offered only when they are real ===');
// A piece product's "other sizes" are genuinely different products on the shelf,
// so the app must not imply they are one product in two pack sizes.
expectTrue('a measure product with a pack offers alternatives', offersPackAlternatives(measureRice));
expectTrue('a piece product does NOT', offersPackAlternatives(pieceSoap) === false);
expectTrue('a measure product with no pack does NOT',
  offersPackAlternatives(halfDeclared) === false);

console.log('\n=== 9. a database string is narrowed safely ===');
// These values come back from Postgres as text; an unexpected one must default to
// the safe, plain presentation rather than throwing.
expect('measure stays measure', asSoldBy('measure'), 'measure');
expect('piece stays piece', asSoldBy('piece'), 'piece');
expect('null defaults to piece', asSoldBy(null), 'piece');
expect('an unknown string defaults to piece', asSoldBy('something-new'), 'piece');
expect('undefined defaults to piece', asSoldBy(undefined), 'piece');

console.log('\n=== 10. no money is touched here ===');
// This module is weight and volume only. If a future edit adds real price
// handling, this is the assertion that should stop it. The check looks for money
// in CODE, not in the prose: the module's own comments explain the shape of a pack
// by contrasting it with paise, and that explanation is the reason the rule exists.
const moduleSource = await import('node:fs').then((fs) =>
  fs.readFileSync(join(root, 'apps/mobile/src/lib/pack.ts'), 'utf8'),
);
// Strip block and line comments before looking, so an explanation cannot fail it.
const codeOnly = moduleSource
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\/\/[^\n]*/g, '');
expectTrue('the pack module handles no money in code', !/paise/i.test(codeOnly));
expectTrue('the pack module imports no money helper', !/from '@\/lib\/money'/.test(codeOnly));
expectTrue('no price variable appears in code', !/\bprice/i.test(codeOnly));

console.log(`\n${failures === 0 ? 'RESULT: all checks passed' : `RESULT: ${failures} FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
