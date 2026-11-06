/**
 * navigation-links.ts — the map link, without an API key.
 *
 * WHY THIS EXISTS
 *
 * "Show the rider on a map" was refused for one honest reason: an embedded map
 * needs a map SDK and a **billing API key**, and a key compiled into a shipped
 * app is a key anyone can lift (`AGENTS.md` §9.6). SCALE-AND-TRACKING.md §6.2
 * keeps the tracking screen text-first for that reason.
 *
 * What is *not* refused is the thing the rider actually asked for — **"take me
 * there"** — because a phone already owns a maps app, and Google Maps accepts a
 * plain HTTPS URL with no key at all:
 *
 *   https://www.google.com/maps/dir/?api=1&destination=12.97,77.59&travelmode=two_wheeler
 *   https://www.google.com/maps/dir/?api=1&destination=Kunigal%20Main%20Road
 *
 * The phone opens it in the installed maps app when it has one, and in the
 * browser when it does not. Nothing is billed, nothing is embedded, nothing is
 * tracked. This module builds those two URL shapes and refuses to build a
 * broken one.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 *
 * - No SDK, no WebView, no tile, no dot, no key (asserted by
 *   `scripts/check-navigation.mjs`, which fails if a `key=` ever appears).
 * - No geocoding. A text destination is handed to the maps app verbatim; if the
 *   customer's address is ambiguous, the maps app shows choices and the rider
 *   picks. Inventing a coordinate from a Kannada landmark is the one thing that
 *   would send a bag to the wrong house.
 * - No distance or ETA of its own. `tracking-rules.ts` owns those numbers so
 *   the app and the database cannot disagree.
 */

/** One place a maps link can point at. */
export interface NavigationTarget {
  /** Fix the app knows exactly. `null`/`NaN`/out-of-range means "unknown". */
  lat?: number | null;
  lng?: number | null;
  /**
   * What to say when there is no fix: the address as a human wrote it, or a
   * rider-readable landmark. May be missing entirely — that is a real state
   * (an order with an empty snapshot) and the caller must not offer a button.
   */
  label?: string | null;
}

/** Google Maps' own accepted travel modes. */
export type TravelMode = 'driving' | 'walking' | 'bicycling' | 'transit' | 'two_wheeler';

const MAPS_ORIGIN = 'https://www.google.com/maps/';

/**
 * How much address text is worth sending. Google truncates the query itself
 * around this length; sending more is bytes on a patchy 4G connection for
 * nothing.
 */
const MAX_LABEL_CHARS = 300;

/** WGS-84 bounds. A fix outside them is a bug, not a place. */
const LAT_MIN = -90;
const LAT_MAX = 90;
const LNG_MIN = -180;
const LNG_MAX = 180;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** True only for a fix this module is willing to put in a URL. */
export function isUsableFix(lat?: number | null, lng?: number | null): boolean {
  return (
    isFiniteNumber(lat) &&
    isFiniteNumber(lng) &&
    lat >= LAT_MIN &&
    lat <= LAT_MAX &&
    lng >= LNG_MIN &&
    lng <= LNG_MAX
  );
}

/** True when there is at least one thing a maps app could act on. */
export function hasNavigationTarget({ lat, lng, label }: NavigationTarget): boolean {
  return isUsableFix(lat, lng) || Boolean(label && label.trim().length > 0);
}

/**
 * The `destination=` value: "12.97,77.59" when a fix exists, otherwise the
 * address text exactly as written (the URL layer encodes it — encoding here
 * would double-encode every `%`). Trimmed and length-capped, because a
 * 3 000-character snapshot is a data-entry accident, not an address.
 */
function destinationValue({ lat, lng, label }: NavigationTarget): string {
  if (isUsableFix(lat, lng)) return `${lat},${lng}`;
  return (label ?? '').trim().slice(0, MAX_LABEL_CHARS);
}

/**
 * Turn-by-turn directions to one place, with no origin: the maps app starts
 * from the device's own location, which is exactly what a rider wants at the
 * moment they are about to set off.
 *
 * Returns `null` when there is nothing to navigate to, so a caller can simply
 * not render the button rather than render one that fails.
 */
export function mapsDirectionsUrl(
  target: NavigationTarget,
  travelMode: TravelMode = 'driving',
): string | null {
  if (!hasNavigationTarget(target)) return null;
  const params = new URLSearchParams();
  params.set('api', '1');
  params.set('destination', destinationValue(target));
  params.set('travelmode', travelMode);
  return `${MAPS_ORIGIN}dir/?${params.toString()}`;
}

/**
 * Show one place (not a route): the customer's "open the rider's position"
 * button, which has a fix and wants a map centred on it, not a route from
 * wherever the customer is standing.
 */
export function mapsPlaceUrl(target: NavigationTarget): string | null {
  if (!isUsableFix(target.lat, target.lng)) return null;
  const params = new URLSearchParams();
  params.set('api', '1');
  params.set('query', `${target.lat},${target.lng}`);
  return `${MAPS_ORIGIN}search/?${params.toString()}`;
}
