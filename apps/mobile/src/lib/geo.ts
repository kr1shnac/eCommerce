/**
 * How far is that door?
 *
 * This is the TypeScript mirror of `public.distance_metres()` and
 * `public.is_usable_fix()` in migration 20261112000004, and it exists for ONE
 * reason: the checkout has to answer "can we deliver to you?" BEFORE the
 * customer taps Place order, and it must give the same answer the database will
 * give a second later.
 *
 * The authority is still the database. `place_order()` recomputes the distance
 * from the same two pins and refuses outside `store_settings.delivery_radius_m`
 * (rule 9.1). This module only lets the screen warn early, in words, instead of
 * letting the customer fill a basket and meet a refusal at the last tap.
 *
 * The constants and the formula are pinned by `npm run check:geo`: the same
 * three points are asserted against `supabase/tests/38_delivery_radius_test.sql`
 * so the two implementations cannot drift.
 *
 * Nothing here formats money, and nothing here reads a React module — that is
 * what makes it runnable from Node.
 */

/** Mean earth radius, metres. Same value as the SQL function. */
export const EARTH_RADIUS_M = 6_371_000;

/**
 * Is this coordinate a place a rider can go to?
 *
 * Mirrors `public.is_usable_fix()` exactly: both numbers present, inside the
 * earth's bounds, and not (0, 0). The null island check matters because that is
 * what a device reports when it has no fix at all — a door drawn in the
 * Atlantic is worse than no door.
 *
 * It also refuses a string and a NaN. A coordinate that arrived from JSON as
 * `"13.03"` would pass a naive `!== null` check and then produce a distance of
 * NaN, which compares false against the radius and would read as "outside".
 */
export function isUsableFix(
  lat: number | null | undefined,
  lng: number | null | undefined,
): boolean {
  return (
    typeof lat === 'number' &&
    typeof lng === 'number' &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180 &&
    !(lat === 0 && lng === 0)
  );
}

/** Narrowing form of the same check, for code that needs the numbers. */
function usableFix(
  lat: number | null | undefined,
  lng: number | null | undefined,
): { lat: number; lng: number } | null {
  return isUsableFix(lat, lng)
    ? { lat: lat as number, lng: lng as number }
    : null;
}

/**
 * Great-circle distance in metres, haversine on a sphere.
 *
 * Null when either end is not a usable fix — never a confident zero. The caller
 * then falls back to the pincode rule, which is exactly what `place_order()`
 * does when a pin is missing.
 */
export function distanceMetres(
  lat1: number | null | undefined,
  lng1: number | null | undefined,
  lat2: number | null | undefined,
  lng2: number | null | undefined,
): number | null {
  const from = usableFix(lat1, lng1);
  const to = usableFix(lat2, lng2);
  if (!from || !to) return null;

  const toRad = (degrees: number) => (degrees * Math.PI) / 180;

  const dLat = toRad(to.lat - from.lat);
  const dLng = toRad(to.lng - from.lng);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(from.lat)) * Math.cos(toRad(to.lat)) * Math.sin(dLng / 2) ** 2;

  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(a));
}

/**
 * A radius in metres as the number a sentence interpolates: 10000 -> "10",
 * 15000 -> "15", 7500 -> "7.5", 15500 -> "15.5".
 *
 * Deliberately NOT a full string with "km" in it: Kannada says "ಕಿ.ಮೀ", and the
 * last place that should decide is this file. The caller interpolates it into a
 * translated sentence such as "we deliver within {radius} km".
 *
 * Rounds to one decimal and drops a trailing ".0", so the common case reads
 * "10", not "10.0".
 */
export function radiusKmLabel(metres: number): string {
  const km = Math.round(metres / 100) / 10;
  return String(km);
}

/** One answer the checkout can show without a round trip. */
export type RadiusVerdict =
  | { kind: 'unknown'; reason: 'no_shop_pin' | 'no_address_pin' }
  | { kind: 'inside'; distanceM: number }
  | { kind: 'outside'; distanceM: number; radiusM: number };

/**
 * The same decision `place_order()` makes in step 6, expressed for the screen.
 *
 *   * both pins -> the distance decides, and the pincode is only a fee lookup;
 *   * either pin missing -> 'unknown', and the screen keeps the old pincode
 *     rule instead of inventing a distance.
 */
export function radiusVerdict(
  shop: { lat: number | null; lng: number | null },
  address: { lat: number | null; lng: number | null } | null | undefined,
  radiusM: number,
): RadiusVerdict {
  if (!isUsableFix(shop.lat, shop.lng)) {
    return { kind: 'unknown', reason: 'no_shop_pin' };
  }
  if (!address || !isUsableFix(address.lat, address.lng)) {
    return { kind: 'unknown', reason: 'no_address_pin' };
  }

  const distanceM = distanceMetres(shop.lat, shop.lng, address.lat, address.lng);
  if (distanceM === null) {
    return { kind: 'unknown', reason: 'no_address_pin' };
  }

  return distanceM <= radiusM
    ? { kind: 'inside', distanceM }
    : { kind: 'outside', distanceM, radiusM };
}

/**
 * Can this basket be promised in express time?
 *
 * Mirrors `delivery_quote()`'s three refusals, in its order: no pin, then
 * distance, then basket size. Kept separate from `radiusVerdict` because
 * express is a narrower promise than delivery: a door can be inside 10 km and
 * outside 5 km, and a 60-unit basket is deliverable but not in 30 minutes.
 */
export type ExpressVerdict =
  | { kind: 'available'; feePaise: number; etaMinutes: number }
  | { kind: 'unavailable'; reason: 'disabled' | 'no_location' | 'too_far' | 'too_many_items' };

export function expressVerdict(
  settings: {
    express_enabled: boolean;
    express_radius_m: number;
    express_eta_minutes: number;
    express_fee_paise: number;
    express_max_units: number;
  },
  shop: { lat: number | null; lng: number | null },
  address: { lat: number | null; lng: number | null } | null | undefined,
  units: number,
): ExpressVerdict {
  if (!settings.express_enabled) return { kind: 'unavailable', reason: 'disabled' };

  const distanceM = address
    ? distanceMetres(shop.lat, shop.lng, address.lat, address.lng)
    : null;

  if (distanceM === null) return { kind: 'unavailable', reason: 'no_location' };
  if (distanceM > settings.express_radius_m) {
    return { kind: 'unavailable', reason: 'too_far' };
  }
  if (units > settings.express_max_units) {
    return { kind: 'unavailable', reason: 'too_many_items' };
  }

  return {
    kind: 'available',
    feePaise: settings.express_fee_paise,
    etaMinutes: settings.express_eta_minutes,
  };
}
