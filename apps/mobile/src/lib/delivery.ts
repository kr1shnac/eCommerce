import type { DeliveryZone, StoreSettings } from '@/types/database';

/**
 * What delivery costs, and what it would cost if the basket were bigger.
 *
 * TWO RULES LIVE HERE, and nowhere else in the app:
 *
 *   1. the fee the customer is shown;
 *   2. the "add ₹X more and delivery is free" nudge that sits under it.
 *
 * Both are only ever DISPLAY. The number the customer is actually charged is
 * computed again inside `place_order()` from the same rows (AGENTS.md rule 9.1),
 * so if these two ever disagree the database is right and this screen is wrong.
 *
 * Why the file exists at all: the fee rule used to live inside `use-shop.ts`,
 * which imports React Query. That meant it could not be exercised from Node —
 * and it is exactly the kind of arithmetic (zone fee beats shop fee, threshold
 * beats both) that is wrong in a way nobody notices until a customer is charged
 * ₹25 they were told they would not pay. `check:delivery` now runs it directly.
 *
 * There is no formatter in here. Paise in, paise out (AGENTS.md rule 1).
 */

export type FeePreview = {
  /** null when the pincode is not served at all. */
  deliveryFeePaise: number | null;
  etaMinutes: number | null;
  isServed: boolean;
};

/**
 * What the delivery would cost, for display. Mirrors place_order()'s rule:
 * the zone's own fee, or the shop default when the zone leaves it blank, and
 * free above the free-delivery threshold.
 */
export function previewFee(
  pincode: string | null | undefined,
  zones: DeliveryZone[] | undefined,
  settings: StoreSettings | undefined,
  subtotalPaise: number,
): FeePreview {
  if (!pincode || !zones || !settings) {
    return { deliveryFeePaise: null, etaMinutes: null, isServed: false };
  }

  const zone = zones.find((candidate) => candidate.pincode === pincode.trim());
  if (!zone) return { deliveryFeePaise: null, etaMinutes: null, isServed: false };

  let fee = zone.delivery_fee_paise ?? settings.delivery_fee_paise;
  if (settings.free_delivery_above_paise !== null && subtotalPaise >= settings.free_delivery_above_paise) {
    fee = 0;
  }

  return { deliveryFeePaise: fee, etaMinutes: zone.eta_minutes, isServed: true };
}

/**
 * What the basket should say about free delivery.
 *
 *   'add-more' — delivery currently costs money and there is a threshold above
 *                the basket; `remainingPaise` is exactly how much more is
 *                needed. Integer paise.
 *   'free'     — delivery on this basket costs nothing. True whether the
 *                threshold was reached or this pincode simply charges no fee;
 *                the customer cares about the fact, not the reason.
 *   'none'     — say nothing. Either the shop has no threshold, the pincode is
 *                unknown/unserved, or the basket is empty.
 *
 * THE HONESTY CASES, all covered by `check:delivery`:
 *
 *   * a zone that already charges ₹0 must get 'free', never "add ₹200 more for
 *     free delivery" — nothing would change, and the nudge would be a lie;
 *   * a basket at/above the threshold must never get 'add-more' with a negative
 *     number;
 *   * an unknown pincode gets 'none' — the app cannot promise a fee for an area
 *     the shop may not deliver to at all;
 *   * an empty basket gets 'none' — there is no delivery to describe.
 *
 * `feeNowPaise` is `previewFee(...).deliveryFeePaise` for the same basket. It is
 * passed in rather than recomputed so the nudge and the fee can never describe
 * two different baskets.
 */
export type FreeDeliveryHint =
  | { kind: 'none' }
  | { kind: 'add-more'; remainingPaise: number }
  | { kind: 'free' };

export function freeDeliveryHint(
  subtotalPaise: number,
  thresholdPaise: number | null | undefined,
  feeNowPaise: number | null | undefined,
): FreeDeliveryHint {
  // Nothing in the basket: no delivery to describe.
  if (!Number.isFinite(subtotalPaise) || subtotalPaise <= 0) return { kind: 'none' };

  // Pincode unknown or unserved: the shop has made no promise here.
  if (feeNowPaise === null || feeNowPaise === undefined) return { kind: 'none' };

  // Delivery already costs nothing. Saying "add more to save" would be false.
  if (feeNowPaise <= 0) return { kind: 'free' };

  if (thresholdPaise === null || thresholdPaise === undefined) return { kind: 'none' };

  const remaining = thresholdPaise - subtotalPaise;
  // At or above the threshold the fee above should have been 0. If a stale
  // basket says otherwise, say nothing rather than promise a saving the app
  // is not making.
  if (remaining <= 0) return { kind: 'none' };

  return { kind: 'add-more', remainingPaise: remaining };
}
