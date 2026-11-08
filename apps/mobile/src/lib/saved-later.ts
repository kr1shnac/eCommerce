/**
 * saved-later.ts — the rules for the "save for later" shelf, and nothing else.
 *
 * WHY THIS IS PURE
 * ----------------
 * The list lives on the phone, next to the cart, and it is written by the same
 * customer taps that move items in and out of the bag. Two lists that overlap
 * are the one mistake that costs money: an item counted in both the basket and
 * the saved shelf is an item the customer thinks they are not buying. That is a
 * silent arithmetic bug, which is exactly the kind this repo puts behind a
 * check script (`scripts/check-saved.mjs`) instead of behind a pair of eyes.
 *
 * WHAT IT DOES NOT KNOW
 * ---------------------
 * Prices, stock, products, React. The caller joins this against live product
 * rows (`hooks/use-cart.ts`), because a price shown here is the shop's price
 * today, never a remembered one (AGENTS.md rule 9.1).
 */

import { MAX_LINES } from '@/store/cart-store';

/** product id -> the quantity the customer last wanted. */
export type QuantityMap = Record<string, number>;

/**
 * The ids of every product this screen needs: the bag, plus the saved shelf,
 * as one sorted list so the query key is a stable string.
 *
 * One query for both lists, not two. On a patchy 4G connection the second
 * round trip is the difference between a screen that appears and one that
 * does not — and both lists are the customer's own `id -> quantity` maps, so
 * the shape is identical.
 */
export function productIdsFor(items: QuantityMap, saved: QuantityMap): string[] {
  const ids = new Set<string>([...Object.keys(items), ...Object.keys(saved)]);
  return [...ids].sort();
}

/**
 * Move saved items back into the bag.
 *
 * The rules, each of which is a bug it prevents:
 *
 * 1. **Nothing is silently dropped when the bag is full** — past the cap the
 *    first `maxLines` *cart* lines win and the rest stay saved, because losing
 *    a customer's item is worse than refusing to add it.
 * 2. **A saved quantity is added to what is already in the bag**, not
 *    overwritten by it. Saving 2 onions and keeping 3 in the bag means 5 when
 *    they change their mind, not 2.
 * 3. **A nonsensical quantity never enters the bag** — a `NaN`, a fractional
 *    number or a zero is a corrupted write, and it is refused rather than
 *    half-applied.
 */
export function mergeIntoCart(
  saved: QuantityMap,
  items: QuantityMap,
  maxLines: number = MAX_LINES,
): QuantityMap {
  const next: QuantityMap = { ...items };

  for (const [productId, quantity] of Object.entries(saved)) {
    const whole = Math.floor(quantity);
    if (!Number.isFinite(whole) || whole <= 0) continue;
    // A line already in the bag is topped up; a new one only joins while
    // there is room, and is left on the shelf otherwise.
    if (next[productId] === undefined && Object.keys(next).length >= maxLines) continue;
    next[productId] = (next[productId] ?? 0) + whole;
  }

  return next;
}

/**
 * A quantity worth keeping: a whole number of packs, at least one, at most 99.
 * The cart cap in `place_order()` is 99, and a saved line beyond it is a write
 * corruption rather than a shopper.
 */
export function isKeepableQuantity(quantity: unknown): quantity is number {
  return (
    typeof quantity === 'number' &&
    Number.isInteger(quantity) &&
    quantity >= 1 &&
    quantity <= 99
  );
}

/**
 * The saved shelf, cleaned of anything that is not a line.
 *
 * Called when the list is read off the device, not only when it is written:
 * AsyncStorage is a plain file, and a half-written object or a hand-edited
 * entry should degrade to "not saved" rather than to a crash on launch —
 * the same rule `readSnapshotAddress` follows for the address snapshot.
 */
export function usableSaved(value: unknown): QuantityMap {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const next: QuantityMap = {};
  for (const [productId, quantity] of Object.entries(value as Record<string, unknown>)) {
    if (!isKeepableQuantity(quantity)) continue;
    if (Object.keys(next).length >= MAX_LINES) break;
    next[productId] = quantity;
  }
  return next;
}
