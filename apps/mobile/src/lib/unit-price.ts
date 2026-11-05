import { packInBase } from '@/lib/pack';
import type { PackUnit } from '@/types/database';

/**
 * The rate behind the pack: ₹ per kilogram, ₹ per litre (register A2).
 *
 * WHY THIS EXISTS. The shop sells the same thing in more than one packet — 500 g
 * of tomato next to 1 kg, 750 ml of oil next to 1 litre. Two prices do not tell a
 * customer which is cheaper; a **rate** does. The rivals publish `pricePerUom`
 * for exactly this reason, and it is the one honest way to compare two packs on
 * the same shelf without arithmetic in the shopper's head.
 *
 * WHY IT IS ITS OWN MODULE. `check:packs` deliberately forbids money in
 * `lib/pack.ts`: that rule is what stopped the register-M4 mistake of making a
 * quantity fractional so 500 g could be ordered, which would have made a line
 * total fractional. So pack arithmetic (weight/volume, no money) stays in
 * `pack.ts`, and the paise conversion lives here. `scripts/check-unit-price.mjs`
 * covers this file the way `check-packs` covers that one.
 *
 * MONEY RULES STILL HOLD. The result is an **integer number of paise**, rounded
 * exactly once, at the end. Nothing here formats a price: callers turn the integer
 * into a string with `formatPaise()` at the UI edge, per AGENTS.md Rule 1.
 */

export type UnitRate = {
  /** Whole paise for one kilogram (weight) or one litre (volume). */
  paise: number;
  /** The unit the rate is quoted in. `piece` products have no rate. */
  unit: 'kg' | 'l';
};

/**
 * The price of one kilogram or one litre, or null when there is no honest rate.
 *
 * Returns null — never a made-up number — for:
 *   * a `piece` product (three soaps have no meaningful "per kg");
 *   * a product the shop has not described with a structured pack;
 *   * a zero or negative pack size, which would divide by zero.
 *
 * The pack is normalised to grams/millilitres first (`packInBase`), so 500 g and
 * 0.5 kg land on the same scale and a 1.5 kg pack is exactly 1500. Multiplying by
 * 1000 before dividing is what turns "paise per gram" into "paise per kilogram"
 * without ever introducing a rupee float.
 */
export function unitRatePaise(
  pricePaise: number | null | undefined,
  packSize: number | null,
  packUnit: PackUnit | null,
): UnitRate | null {
  if (pricePaise === null || pricePaise === undefined) return null;
  if (!Number.isFinite(pricePaise) || pricePaise < 0) return null;
  if (packSize === null || packUnit === null) return null;
  if (!Number.isFinite(packSize) || packSize <= 0) return null;
  if (packUnit === 'piece') return null;

  const base = packInBase(packSize, packUnit);
  if (base === null || !Number.isFinite(base) || base <= 0) return null;

  const unit: UnitRate['unit'] = packUnit === 'g' || packUnit === 'kg' ? 'kg' : 'l';
  // `base` is grams (for kg) or millilitres (for l); 1000 of either make one
  // unit. Round once, here, to the nearest paisa.
  return { paise: Math.round((pricePaise * 1000) / base), unit };
}
