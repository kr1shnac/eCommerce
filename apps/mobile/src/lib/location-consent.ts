import { deviceStorage } from '@/lib/storage';

/**
 * Whether this rider has agreed to share their location while delivering.
 *
 * Stored on the device (AsyncStorage), not in the database: consent is a
 * property of this phone and this rider, not of the account. It survives
 * sign-out so a rider who logs back in is not re-asked, and a new rider on a
 * used phone starts from "not yet".
 *
 * The value is a timestamp (ms) of when consent was given, or absent. A
 * boolean would lose the answer to "when did they last agree", which is the
 * only honest thing to show if the rider ever asks.
 */

const KEY = 'kunigal.location-consent';

export async function hasLocationConsent(): Promise<boolean> {
  const raw = await deviceStorage.getItem(KEY);
  return raw !== null;
}

export async function recordLocationConsent(): Promise<void> {
  await deviceStorage.setItem(KEY, Date.now().toString());
}

export async function clearLocationConsent(): Promise<void> {
  await deviceStorage.removeItem(KEY);
}
