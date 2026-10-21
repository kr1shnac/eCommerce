/**
 * tracking-rules.ts — when a rider's phone is allowed to write a position, and
 * when a position is too old to show.
 *
 * WHY THIS IS A SEPARATE, PURE MODULE
 * -----------------------------------
 * Two of the most expensive mistakes in this app live in this decision:
 *
 *   * Write too often and a rider's battery dies before the last delivery, which
 *     is a feature that gets turned off in week two.
 *   * Show a stale dot as if it were live and the customer walks out to the road
 *     and waits — a confident lie, which is the one thing `PRODUCTION.md` §2
 *     refuses.
 *
 * Neither mistake is visible in a screenshot, and neither can be caught by
 * squinting at a phone. So the rule is a pure function of numbers, and
 * `npm run check:tracking` exercises it. Same discipline as `speech-rules.ts`
 * and `pack.ts`: anything that can be reasoned about without a device is kept out
 * of the component that cannot be tested.
 *
 * WHAT THIS FILE DELIBERATELY DOES NOT DO
 * ---------------------------------------
 * It never imports `expo-location`, never touches `Date.now()` unless the caller
 * passes it, and never formats a string for a customer. The throttle takes
 * `now` as an argument so a test can travel in time; the UI formats through
 * i18n so Kannada is not an afterthought.
 *
 * The design this implements is `SCALE-AND-TRACKING.md` §6.4 (throttling) and
 * §6.6 rule 3 (positions expire). Read that before changing a number here.
 */

/** A position as the phone reports it. */
export type Coordinates = {
  /** Degrees north. -90 … 90. */
  lat: number;
  /** Degrees east. -180 … 180. */
  lng: number;
  /** Horizontal accuracy in metres, as the GPS reports it. Optional. */
  accuracyM?: number | null;
};

/**
 * Why a write did or did not happen. Returned rather than a bare boolean so the
 * rider screen can say something true ("paused while the app is closed") and so
 * a test can assert the *reason*, not just the outcome. A boolean would let a
 * future edit swap one reason for another and stay green.
 */
export type RecordReason =
  /** No order is out for delivery, so nothing is tracked. */
  | 'no_active_delivery'
  /** The app is not in the foreground. */
  | 'backgrounded'
  /** A position was written recently enough. */
  | 'too_soon'
  /** Nothing moved enough to be worth a write. */
  | 'not_moved'
  /** The coordinates are not a real place (NaN, out of range, or 0,0). */
  | 'invalid_fix'
  /** Yes. */
  | 'record';

/**
 * The thresholds. Every number here is a deliberate choice, not a default.
 *
 * These are exported so `check-tracking.mjs` asserts against the constants
 * rather than against magic numbers copied into the test — if someone tunes the
 * interval, the test follows and keeps testing the *rule* instead of an old
 * decision.
 */

/**
 * While moving: a dot that jumps every 25 s reads as live.
 *
 * "Moving" is decided by displacement, not by a derived speed — see
 * `shouldRecordPosition` step 4 for why that distinction mattered.
 */
export const MOVING_INTERVAL_MS = 25_000;

/**
 * While stopped: 2.5 minutes. Nothing is changing, and the only reason to write
 * at all is so "updated 2 min ago" does not slide into "we lost them".
 */
export const STATIONARY_INTERVAL_MS = 150_000;

/**
 * Below this, a "new" fix is noise. GPS jitter while a bike is parked is 5–15 m;
 * writing that turns a stationary rider into a rider drifting across the map.
 */
export const MIN_MOVED_METRES = 15;

/**
 * A position older than this is **not shown at all** (`SCALE-AND-TRACKING.md`
 * §6.6 rule 3). Ten minutes is longer than any gap a working throttle produces,
 * so if we are this stale the honest answer is "we do not know right now".
 */
export const STALE_AFTER_MS = 10 * 60_000;

/**
 * The speed used to turn a straight-line distance into an ETA: 5.5 m/s ≈ 20 km/h.
 *
 * Deliberately conservative. A two-wheeler in Kunigal does not average more than
 * this on a road with a market street in it, and an ETA that is beaten feels
 * like good service while an ETA that is missed feels like a broken promise.
 */
export const ETA_SPEED_MPS = 5.5;

/** Never promise less than this. "Arriving in 1 minute" is a promise a shop cannot keep. */
export const ETA_FLOOR_MINUTES = 3;

/** Beyond this the number stops being useful and starts being noise. */
export const ETA_CEILING_MINUTES = 45;

/** A phone fix worse than this is not worth showing as "where he is". */
export const MAX_USABLE_ACCURACY_M = 150;

/**
 * Is this a coordinate a phone could actually be at?
 *
 * `0, 0` is rejected on purpose: it is "Null Island", in the Atlantic, and it is
 * what a location library returns when it has failed but been asked to produce
 * something. Showing it would put the rider in the ocean.
 */
export function isValidFix(fix: Coordinates | null | undefined): fix is Coordinates {
  if (!fix) return false;
  const { lat, lng } = fix;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  if (lat < -90 || lat > 90) return false;
  if (lng < -180 || lng > 180) return false;
  if (lat === 0 && lng === 0) return false;
  return true;
}

/**
 * Great-circle distance in metres.
 *
 * Haversine, not a flat approximation: at 12.9° N the difference is small, but
 * the formula costs the same and does not need a comment explaining when it
 * stops working.
 */
export function distanceMetres(a: Coordinates, b: Coordinates): number {
  const R = 6_371_000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export type RecordInput = {
  /** Is there an order in `out_for_delivery` assigned to this rider right now? */
  hasActiveDelivery: boolean;
  /** Is the app in the foreground? */
  isForeground: boolean;
  /** The fix the phone just produced. */
  fix: Coordinates | null | undefined;
  /** When the last position was written. `null` if never. */
  lastRecordedAtMs: number | null;
  /** The previous accepted fix, used to notice that nothing moved. `null` if none. */
  lastFix: Coordinates | null;
  /** Now, passed in so a test can control it. */
  nowMs: number;
};

export type RecordDecision = {
  write: boolean;
  reason: RecordReason;
};

/**
 * The throttle. This is the single place that decides whether the phone talks to
 * the network, and it is called at most once per GPS callback.
 *
 * Order of checks matters and is asserted by the test: privacy before cost, cost
 * before movement, movement before a write. A rider with no delivery must never
 * be tracked even if their phone produces a perfect fix every second.
 */
export function shouldRecordPosition(input: RecordInput): RecordDecision {
  const { hasActiveDelivery, isForeground, fix, lastRecordedAtMs, lastFix, nowMs } = input;

  // 1. Privacy first. No delivery, no tracking — this is the rule the consent
  //    screen promises, so it is checked before anything cheap.
  if (!hasActiveDelivery) return { write: false, reason: 'no_active_delivery' };

  // 2. Background. Background GPS is the battery killer; a rider with the app
  //    closed is not tracked. The caller writes one final "last seen" before
  //    this returns false (see `shouldWriteOnBackground`).
  if (!isForeground) return { write: false, reason: 'backgrounded' };

  // 3. Is the fix real?
  if (!isValidFix(fix)) return { write: false, reason: 'invalid_fix' };

  // 4. The clock. Which clock applies depends on whether the bike is moving.
  //
  //    NOTE ON WHY THIS COMPARES DISPLACEMENT AND NOT A DERIVED SPEED. An earlier
  //    draft divided distance by elapsed time to get metres per second and
  //    compared that to MOVING_SPEED_MPS. It was wrong in a way that is easy to
  //    miss: a rider threading a market street at 6 km/h covers 50 m in 30 s,
  //    which derives to 1.7 m/s, which is below the threshold — so the dot would
  //    silently drop to the 2.5-minute clock exactly when the customer is most
  //    anxious. Displacement since the last write is the signal we actually have,
  //    it degrades gracefully, and 15 m is unambiguous: a parked bike does not
  //    move 15 m.
  //
  //    Checked *last* on purpose. A parked bike jittering must not reset the
  //    clock, and an invalid fix must not be written even if everything else is
  //    perfect — so privacy, foreground and fix validity all come first.
  const since = lastRecordedAtMs === null ? Infinity : nowMs - lastRecordedAtMs;
  const moved = lastFix && isValidFix(lastFix) ? distanceMetres(lastFix, fix) : Infinity;

  if (moved < MIN_MOVED_METRES) {
    return since >= STATIONARY_INTERVAL_MS
      ? { write: true, reason: 'record' }
      : { write: false, reason: 'not_moved' };
  }

  return since >= MOVING_INTERVAL_MS
    ? { write: true, reason: 'record' }
    : { write: false, reason: 'too_soon' };
}

/**
 * Going to the background: write one last position, then stop.
 *
 * Returning `true` here does NOT mean "keep tracking". It means "send exactly
 * one final fix so the customer is not left with a dot from eight minutes ago
 * that we know is wrong". The caller then stops the subscription.
 */
export function shouldWriteOnBackground(input: {
  hasActiveDelivery: boolean;
  fix: Coordinates | null | undefined;
  lastRecordedAtMs: number | null;
  nowMs: number;
}): boolean {
  const { hasActiveDelivery, fix, lastRecordedAtMs, nowMs } = input;
  if (!hasActiveDelivery) return false;
  if (!isValidFix(fix)) return false;
  if (lastRecordedAtMs === null) return true;
  // If the last write was seconds ago the final fix adds nothing.
  return nowMs - lastRecordedAtMs >= MOVING_INTERVAL_MS;
}

/**
 * May this stored position be shown to a customer at all?
 *
 * `false` means the screen must fall back to the status ladder and the call
 * button — **not** to a greyed-out dot. A dot that cannot be trusted should not
 * be drawn (`SCALE-AND-TRACKING.md` §6.1 point 3).
 */
export function isPositionShowable(input: {
  recordedAtMs: number | null;
  nowMs: number;
  accuracyM?: number | null;
}): boolean {
  const { recordedAtMs, nowMs, accuracyM } = input;
  if (recordedAtMs === null) return false;
  const age = nowMs - recordedAtMs;
  // A clock skew that puts the fix in the future is not a position we understand.
  if (age < 0) return false;
  if (age > STALE_AFTER_MS) return false;
  if (accuracyM != null && accuracyM > MAX_USABLE_ACCURACY_M) return false;
  return true;
}

/**
 * How old a position is, in whole seconds, for "updated 20 s ago".
 *
 * Clamped at zero: a slightly future timestamp from a rider's clock must read as
 * "just now", not as a negative age that renders as nonsense in Kannada.
 */
export function positionAgeSeconds(recordedAtMs: number, nowMs: number): number {
  return Math.max(0, Math.floor((nowMs - recordedAtMs) / 1000));
}

/**
 * The ETA, in whole minutes, from a straight-line distance.
 *
 * This is a *lower bound dressed as an estimate*, and that is intentional. It
 * assumes the rider can travel in a straight line, which he cannot, and then
 * applies a slow speed to compensate. The result is that the promise is usually
 * beaten, which is the direction an estimate should err.
 *
 * Returns `null` when there is no honest number to give: an unknown distance, a
 * rider already at the door, or a distance so large that the estimate is fiction.
 */
export function etaMinutesFor(distanceM: number | null): number | null {
  if (distanceM === null || !Number.isFinite(distanceM) || distanceM < 0) return null;
  const raw = distanceM / ETA_SPEED_MPS / 60;
  const rounded = Math.ceil(raw);
  if (rounded <= ETA_FLOOR_MINUTES) return ETA_FLOOR_MINUTES;
  if (rounded > ETA_CEILING_MINUTES) return null;
  return rounded;
}

/**
 * Distance as a number and a unit, for the UI to translate.
 *
 * The module returns `{ value, unit }` and never a formatted string, because
 * "1.2 km" in Kannada is "1.2 ಕಿ.ಮೀ" and the last place that should be decided
 * is here. Rounding: below 1 km, to the nearest 50 m (a GPS dot cannot honestly
 * claim 5 m precision to a customer); above 1 km, to one decimal.
 */
export function formatDistance(distanceM: number | null): { value: number; unit: 'm' | 'km' } | null {
  if (distanceM === null || !Number.isFinite(distanceM) || distanceM < 0) return null;
  if (distanceM < 1000) {
    const rounded = Math.round(distanceM / 50) * 50;
    // Rounding up can reach 1000 (e.g. 990 m). Reporting "1000 m" instead of
    // "1 km" is the kind of small wrongness a customer notices.
    if (rounded < 1000) return { value: Math.max(50, rounded), unit: 'm' };
  }
  return { value: Math.round(distanceM / 100) / 10, unit: 'km' };
}

/**
 * Has the rider reached the door? Used to switch the customer's screen from
 * "1.2 km away" to "arriving", which is the only sentence that matters at the end.
 *
 * 60 m is about the width of a courtyard plus a lane. Below that, "distance"
 * stops being meaningful and "he is here" is the true thing to say.
 */
export const ARRIVED_METRES = 60;

export function hasArrived(distanceM: number | null): boolean {
  return distanceM !== null && Number.isFinite(distanceM) && distanceM <= ARRIVED_METRES;
}
