import type { Coordinates } from '@/lib/tracking-rules';

/**
 * The one place the app is allowed to touch the device's location.
 *
 * WHY THIS FILE EXISTS (the same trap as `storage.ts`, one level worse)
 * --------------------------------------------------------------------
 * `app.json` sets `"web": { "output": "static" }`, so `expo start` PRERENDERS the
 * app in Node. `@react-native-async-storage/async-storage` already crashed that
 * prerender once with `ReferenceError: window is not defined` — see
 * `src/lib/storage.ts`, which is the whole story. `expo-location` is the same
 * hazard: its web build talks to `navigator.geolocation`, and `require` of a
 * native module in a runtime with no native side is at best a warning and at
 * worst a throw before the first frame.
 *
 * So the package is never imported at module scope. It is loaded **inside a
 * function**, and only when `typeof window !== 'undefined'` — the same runtime
 * test `storage.ts` uses, because the failure is about the runtime, not about
 * the build type.
 *
 * WHY A DYNAMIC `import()` AND NOT `require`
 * -----------------------------------------
 * Static analysis can see it, Metro can still resolve it (it becomes a lazy
 * chunk), and TypeScript type-checks the shape through
 * `typeof import('expo-location')` without the value ever being evaluated early.
 * A bare `require()` would need an eslint exemption and would be invisible to
 * the type checker's module graph.
 *
 * THE ONE RULE THIS FILE OWNS
 * ---------------------------
 * Foreground, while delivering, and nothing else. `app.json` asks for
 * `ACCESS_COARSE_LOCATION` / `ACCESS_FINE_LOCATION` only: the Always variants are
 * explicitly removed from `Info.plist`, `ACCESS_BACKGROUND_LOCATION` is blocked
 * on Android, and the location foreground service is off. A rider is not tracked
 * when the app is closed, which is what the consent screen promises and what
 * `shouldRecordPosition()` enforces one layer up.
 *
 * WHAT THIS FILE DOES NOT DECIDE
 * ------------------------------
 * It never decides *whether* a fix should be sent (that is `tracking-rules.ts`,
 * which is pure and tested), and it never talks to the database. It answers one
 * question — "what does the phone say right now" — and hands that up.
 */

/** True when this runtime can have a location at all. */
export function hasLocationRuntime(): boolean {
  return typeof window !== 'undefined';
}

/** The answer to "may I read your location", in the app's own vocabulary. */
export type ForegroundPermission =
  /** The rider said yes, this time or earlier. */
  | 'granted'
  /** The rider said no. Do not ask again from this screen; respect it. */
  | 'denied'
  /** No runtime, no module, or a platform that cannot answer. */
  | 'unavailable';

type LocationModule = typeof import('expo-location');

let modulePromise: Promise<LocationModule | null> | null = null;

/**
 * Load `expo-location` once, and only where it can exist.
 *
 * Returns `null` in Node (the prerender), and also when the module fails to load
 * for any reason: a rider screen that cannot track should degrade to "tracking
 * unavailable", never to a white screen or a crash report from every launch.
 */
async function locationModule(): Promise<LocationModule | null> {
  if (!hasLocationRuntime()) return null;
  if (!modulePromise) {
    modulePromise = import('expo-location').catch(() => null);
  }
  return modulePromise;
}

/**
 * Ask for foreground permission, translating the platform's answer into ours.
 *
 * `canAskAgain` is deliberately ignored here: the caller shows one screen with
 * one button, and a rider who has permanently denied needs the Android/iOS
 * settings app, not a second dialog from us. Pressing the button again when the
 * OS will not show a prompt returns `denied` immediately, which is the honest
 * answer.
 */
export async function requestForegroundPermission(): Promise<ForegroundPermission> {
  const location = await locationModule();
  if (!location) return 'unavailable';

  try {
    const existing = await location.getForegroundPermissionsAsync();
    if (existing.status === 'granted') return 'granted';
    const asked = await location.requestForegroundPermissionsAsync();
    return asked.status === 'granted' ? 'granted' : 'denied';
  } catch {
    return 'unavailable';
  }
}

/** What the OS currently says, without prompting. */
export async function getForegroundPermission(): Promise<ForegroundPermission> {
  const location = await locationModule();
  if (!location) return 'unavailable';

  try {
    const current = await location.getForegroundPermissionsAsync();
    return current.status === 'granted' ? 'granted' : 'denied';
  } catch {
    return 'unavailable';
  }
}

/**
 * The last position the phone already knows, which may be seconds or minutes
 * old and may be `null`.
 *
 * Used for exactly one thing: the single fix written when the app goes to the
 * background, so the customer is not left with a dot from eight minutes ago. It
 * is never used to *start* tracking, because a known-stale position is not
 * "where he is now".
 */
export async function lastKnownFix(): Promise<Coordinates | null> {
  const location = await locationModule();
  if (!location) return null;

  try {
    const last = await location.getLastKnownPositionAsync({ maxAge: 5 * 60_000 });
    return last ? toCoordinates(last) : null;
  } catch {
    return null;
  }
}

export type LocationWatch = { stop: () => void };

/**
 * Start watching the phone's position. The caller stops it; this module has no
 * timer of its own and no opinion about when to stop.
 *
 * `Accuracy.Balanced` on purpose: it is within the 150 m the read view will
 * accept, and `High` costs materially more battery for a delivery measured in
 * one or two kilometres. The throttle (`tracking-rules.ts`) is what keeps the
 * *network* quiet; this setting is what keeps the *GPS* quiet.
 *
 * Resolves to `null` when there is no runtime or no permission — the caller then
 * shows "tracking is off" rather than retrying forever.
 */
export async function watchPosition(
  onFix: (fix: Coordinates | null) => void,
): Promise<LocationWatch | null> {
  const location = await locationModule();
  if (!location) return null;

  const permission = await getForegroundPermission();
  if (permission !== 'granted') return null;

  try {
    const subscription = await location.watchPositionAsync(
      {
        accuracy: location.Accuracy.Balanced,
        // Ask the OS for a fix at most every 10 s and only after 10 m of travel.
        // The write throttle is looser than this on purpose: this only decides
        // how often the *radio* wakes, not how often the server hears from us.
        timeInterval: 10_000,
        distanceInterval: 10,
      },
      (position) => onFix(toCoordinates(position)),
    );
    return { stop: () => subscription.remove() };
  } catch {
    return null;
  }
}

/** The platform's position shape, narrowed to the four numbers we use. */
function toCoordinates(position: {
  coords: { latitude: number; longitude: number; accuracy: number | null };
}): Coordinates {
  return {
    lat: position.coords.latitude,
    lng: position.coords.longitude,
    accuracyM: position.coords.accuracy ?? null,
  };
}
