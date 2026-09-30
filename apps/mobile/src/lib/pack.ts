import type { PackUnit, Product, ProductSoldBy } from '@/types/database';

/**
 * What a "unit" of a product actually is (register M4).
 *
 * THE QUESTION THIS ANSWERS. Kunigal's shop sells rice by the kilo, oil by the
 * litre, and soap by the piece. The app stores a pack as a number and a unit —
 * Tomato is `(500, 'g')` — so it can tell that Tomato and Onion are the same kind
 * of thing in different pack sizes, and can say what three packets weigh.
 *
 * WHY THE QUANTITY IS STILL AN INTEGER. The obvious way to sell 500 g would be a
 * fractional quantity (0.5 kg). That was rejected, and the reasoning is in
 * `supabase/migrations/20261021000004_pack_sizes.sql`: `line_total_paise` is a
 * generated `price_paise * quantity`, so a fractional quantity makes the money
 * fractional, and two roundings (line totals and the order total) that can differ
 * by a paisa is exactly the bug integer paise exists to prevent. A half-kilo in
 * this shop is a **packet**, priced as a packet — so `quantity` counts packets.
 *
 * This module is pure: no React, no network, no database. It is imported by the
 * product screen and covered by `scripts/check-packs.mjs`, because "500 g × 3 =
 * 1.5 kg" is arithmetic, and arithmetic that is only ever exercised by looking at
 * a phone is arithmetic nobody has checked.
 */

/** The base unit for a measure, so grams and kilograms share one scale. */
const BASE_UNIT: Record<PackUnit, PackUnit> = {
  g: 'g',
  kg: 'g',
  ml: 'ml',
  l: 'ml',
  piece: 'piece',
};

/** How many of the base unit one of `unit` is worth: 1 kg = 1000 g, 1 l = 1000 ml. */
const BASE_FACTOR: Record<PackUnit, number> = {
  g: 1,
  kg: 1000,
  ml: 1,
  l: 1000,
  piece: 1,
};

/**
 * A pack size, normalised to the base unit for comparisons.
 *
 * Grams and kilograms both land in **grams**; millilitres and litres in
 * **millilitres**. `piece` never converts. The scaling is a plain multiplication
 * of a weight or volume — no money is involved, so no paise is rounded.
 *
 * The factor is exactly 1000 either side of the base, so a fractional pack the
 * schema allows (`numeric(10,3)`, e.g. 1.5 kg) converts to 1500 g exactly.
 */
export function packInBase(size: number | null, unit: PackUnit | null): number | null {
  if (size === null || unit === null) return null;
  return size * BASE_FACTOR[unit];
}

/** The base unit a normalised pack is expressed in. */
export function baseUnitFor(unit: PackUnit | null): PackUnit | null {
  if (unit === null) return null;
  return BASE_UNIT[unit];
}

/**
 * How much the whole basket line weighs or holds, as a number in the base unit.
 * Three 500 g packets is 1500 (g). A piece product returns null — there is no
 * meaningful "total weight" of three soaps.
 */
export function lineBaseQuantity(
  size: number | null,
  unit: PackUnit | null,
  quantity: number,
): number | null {
  const one = packInBase(size, unit);
  if (one === null) return null;
  return one * quantity;
}

/**
 * A short spoken/printed summary of a line's total size: "1.5 kg", "750 ml".
 *
 * Never invents a unit the shop did not use: a 500 g pack × 3 says **1.5 kg**
 * because that is how a shopkeeper says it, not "1500 g". Below one unit it stays
 * small ("250 g", not "0.25 kg"), because nobody says "nought point two five
 * kilos".
 *
 * Returns null when there is nothing meaningful to say, so the caller renders
 * nothing rather than "null kg".
 */
export function formatLineSize(
  size: number | null,
  unit: PackUnit | null,
  quantity: number,
): string | null {
  if (size === null || unit === null) return null;
  const total = lineBaseQuantity(size, unit, quantity);
  if (total === null) return null;

  // Only g and ml have a bigger sibling unit to climb into. `piece` just counts.
  const base = BASE_UNIT[unit];
  if (base === 'g' || base === 'ml') {
    const big = base === 'g' ? 'kg' : 'l';
    // 1.5 kg is what is said out loud; 1500 g is not. Below a thousand the small
    // unit stays, because nobody says "nought point two five kilos".
    return total >= 1000 ? `${trimNumber(total / 1000)} ${big}` : `${trimNumber(total)} ${base}`;
  }
  return `${trimNumber(total)} ${base}`;
}

/** 1500 -> "1.5", 1000 -> "1", 500 -> "500", 250.5 -> "250.5". No trailing zeros. */
export function trimNumber(value: number): string {
  if (!Number.isFinite(value)) return '0';
  const rounded = Math.round(value * 1000) / 1000;
  return String(rounded);
}

/**
 * Should this product offer pack-size alternatives?
 *
 * Only a `measure` product has alternatives worth offering, and only when the app
 * actually knows the pack. A piece product is counted, and its "alternative sizes"
 * are genuinely separate products (a 200 ml bottle and a 1 l bottle are different
 * things on the shelf), so the app must not imply they are one product.
 */
export function offersPackAlternatives(product: Pick<Product, 'sold_by' | 'pack_size' | 'pack_unit'>): boolean {
  return product.sold_by === 'measure' && product.pack_size !== null && product.pack_unit !== null;
}

/**
 * The label for a pack, in the shop's own words: "500 g", "1 kg", "1 piece".
 *
 * Falls back to the free-text `unit` when there is no structured pack, which is
 * the whole point — a product the shop has not described in structured terms still
 * shows exactly what it showed before this feature existed.
 */
export function packLabel(
  product: Pick<Product, 'sold_by' | 'pack_size' | 'pack_unit' | 'unit'>,
): string {
  if (product.sold_by === 'measure' && product.pack_size !== null && product.pack_unit !== null) {
    return `${trimNumber(product.pack_size)} ${product.pack_unit}`;
  }
  return product.unit;
}

/** Narrow a string to the enum, for values coming back from the database. */
export function asSoldBy(value: string | null | undefined): ProductSoldBy {
  return value === 'measure' ? 'measure' : 'piece';
}
