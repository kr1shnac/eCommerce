#!/usr/bin/env node
/**
 * check-delivery.mjs — what delivery costs, and the "add ₹X more" nudge.
 *
 * Run:  npm run check:delivery
 *
 * WHY THIS EXISTS
 *
 * `apps/mobile/src/lib/delivery.ts` holds two rules that must agree with
 * `place_order()` in the database:
 *
 *   1. the fee the customer is shown on the cart and at checkout;
 *   2. the "Add ₹X more and delivery is free" line under it.
 *
 * The fee rule already existed, inside `use-shop.ts` — but that module imports
 * React Query, so the arithmetic could not be exercised from Node and had never
 * been tested at all. It decides whether a customer pays ₹0 or ₹35, and it
 * reads three nullable columns (`delivery_zones.delivery_fee_paise`,
 * `store_settings.delivery_fee_paise`, `store_settings.free_delivery_above_paise`)
 * whose precedence is easy to get subtly wrong.
 *
 * WHAT IT PROVES
 *
 *   1. `previewFee` follows place_order()'s precedence: the zone's own fee, else
 *      the shop default; free at or above the threshold; null for an area the
 *      shop does not serve.
 *   2. `freeDeliveryHint` never lies:
 *        * a pincode that already charges ₹0 says "free", never "add more";
 *        * an unknown pincode says nothing (no promise for unserved areas);
 *        * an empty basket says nothing;
 *        * it never returns a zero or negative "remaining".
 *   3. The two rules agree: every "add-more" hint is exactly the amount that
 *      takes the basket to a ₹0 fee, checked by feeding `subtotal + remaining`
 *      back into `previewFee`.
 *
 * Nothing here proves how the line looks on a phone. Only a device run does that
 * (PRODUCTION.md §5).
 */
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const MODULE = pathToFileURL(join(root, 'apps/mobile/src/lib/delivery.ts')).href;

const { previewFee, freeDeliveryHint } = await import(MODULE);

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

// The seed's real numbers: shop fee ₹25, free above ₹500, Kunigal Town ₹15,
// a hypothetical free zone, and an area the shop does not serve at all.
const settings = {
  delivery_fee_paise: 2500,
  free_delivery_above_paise: 50000,
  min_order_value_paise: 10000,
};
const zones = [
  { pincode: '572130', delivery_fee_paise: 1500, eta_minutes: 10, is_active: true },
  { pincode: '571916', delivery_fee_paise: null, eta_minutes: 20, is_active: true },
  { pincode: '572111', delivery_fee_paise: 0, eta_minutes: 30, is_active: true },
];
const feeFor = (pincode, subtotal, over = {}) =>
  previewFee(pincode, zones, { ...settings, ...over }, subtotal).deliveryFeePaise;

console.log('=== 1. previewFee: zone fee, then shop fee, then the threshold ===');
expect('an unserved pincode has no fee to show', feeFor('999999', 40000), null);
expect('no pincode at all has no fee to show', feeFor(null, 40000), null);
expect('an empty pincode has no fee to show', feeFor('   ', 40000), null);
expect('the zone fee beats the shop fee', feeFor('572130', 40000), 1500);
expect('a blank zone fee falls back to the shop fee', feeFor('571916', 40000), 2500);
expect('a zero zone fee stays zero', feeFor('572111', 40000), 0);
expect('a pincode with spaces still matches', feeFor(' 572130 ', 40000), 1500);

expect('one paisa below the threshold still pays the zone fee', feeFor('572130', 49999), 1500);
expect('exactly at the threshold is free', feeFor('572130', 50000), 0);
expect('above the threshold is free', feeFor('572130', 75000), 0);
expect('free delivery beats a zero zone fee without changing it', feeFor('572111', 50000), 0);
expect('no threshold means never free', feeFor('572130', 75000, { free_delivery_above_paise: null }), 1500);

// The three "cannot show a fee" inputs must not throw and must not invent one.
expect('missing settings is unserved, not a crash',
  previewFee('572130', zones, undefined, 40000).deliveryFeePaise, null);
expect('missing zones is unserved, not a crash',
  previewFee('572130', undefined, settings, 40000).deliveryFeePaise, null);
expect('the ETA comes from the zone, not the shop',
  previewFee('572111', zones, settings, 40000).etaMinutes, 30);

console.log('\n=== 2. freeDeliveryHint: only what is true ===');
const hint = (subtotal, threshold = settings.free_delivery_above_paise, fee) =>
  freeDeliveryHint(subtotal, threshold, fee === undefined ? feeFor('572130', subtotal) : fee);

expect('a fee-paying basket below the line is told how much more',
  hint(40000), { kind: 'add-more', remainingPaise: 10000 });
expect('one paisa short asks for one paisa',
  hint(49999), { kind: 'add-more', remainingPaise: 1 });
expect('at the threshold the fee is already zero, so it says free',
  hint(50000), { kind: 'free' });
expect('above the threshold it says free',
  hint(75000), { kind: 'free' });

// THE HONESTY CASE. A zone that charges nothing must never be sold a nudge:
// adding items would save the customer exactly ₹0.
expect('an already-free pincode is free, not "add more"',
  freeDeliveryHint(40000, settings.free_delivery_above_paise, 0), { kind: 'free' });
expect('a zero-fee zone below the threshold is free, not "add more"',
  hint(40000, settings.free_delivery_above_paise, feeFor('572111', 40000)), { kind: 'free' });

expect('an unknown pincode says nothing',
  freeDeliveryHint(40000, settings.free_delivery_above_paise, null), { kind: 'none' });
expect('an undefined fee says nothing',
  freeDeliveryHint(40000, settings.free_delivery_above_paise, undefined), { kind: 'none' });
expect('no threshold means no nudge',
  freeDeliveryHint(40000, null, 1500), { kind: 'none' });
expect('an undefined threshold means no nudge',
  freeDeliveryHint(40000, undefined, 1500), { kind: 'none' });
expect('an empty basket says nothing even when delivery is free',
  freeDeliveryHint(0, settings.free_delivery_above_paise, 0), { kind: 'none' });
expect('a negative subtotal is not a basket',
  freeDeliveryHint(-500, settings.free_delivery_above_paise, 1500), { kind: 'none' });
// Stale data: the thicket above the threshold but a fee > 0. Never promise a
// saving the app is not making.
expect('a contradictory fee above the threshold says nothing',
  freeDeliveryHint(60000, settings.free_delivery_above_paise, 1500), { kind: 'none' });

console.log('\n=== 3. the nudge and the fee rule agree ===');
// Feed the promised amount back in: crossing the line must really produce ₹0.
for (const subtotal of [1, 15000, 39999, 40000, 49999]) {
  const h = freeDeliveryHint(subtotal, settings.free_delivery_above_paise, feeFor('572130', subtotal));
  const after = feeFor('572130', subtotal + h.remainingPaise);
  expectTrue(`adding the ₹${h.remainingPaise / 100} it asks for makes delivery free (from ${subtotal})`,
    h.kind === 'add-more' && after === 0);
}

// The remaining amount is always an integer, always positive, and exactly the
// threshold minus the basket.
expectTrue('every "add-more" is integer paise, and equals threshold minus basket', (() => {
  for (let subtotal = 1; subtotal < 50000; subtotal += 137) {
    const h = freeDeliveryHint(subtotal, 50000, 1500);
    if (h.kind !== 'add-more') return false;
    if (!Number.isInteger(h.remainingPaise)) return false;
    if (h.remainingPaise !== 50000 - subtotal) return false;
    if (h.remainingPaise <= 0) return false;
  }
  return true;
})());

// And a "free" hint is only ever returned for a basket that exists and a fee
// the shop would actually charge nothing for.
expectTrue('"free" only when the fee is zero', (() => {
  for (let subtotal = 1; subtotal <= 80000; subtotal += 2500) {
    const fee = feeFor('572130', subtotal);
    const h = freeDeliveryHint(subtotal, 50000, fee);
    if (h.kind === 'free' && fee !== 0) return false;
    if (h.kind === 'add-more' && fee === 0) return false;
  }
  return true;
})());

console.log(`\n${failures === 0 ? 'RESULT: all checks passed' : `RESULT: ${failures} FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
