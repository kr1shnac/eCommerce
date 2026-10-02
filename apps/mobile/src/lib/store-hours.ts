import type { StoreSettings } from '@/types/database';

/**
 * Is the shop open right now? A *courtesy* answer for the UI only.
 *
 * place_order() repeats this check in Postgres and refuses the order if the
 * shop is shut, so this can never let a closed shop take money. Its only job is
 * to stop the customer filling in their address for nothing at 11pm.
 *
 * It deliberately mirrors the SQL in 20261002000008_place_order.sql, including
 * the overnight case (22:00 to 02:00).
 */

const IST_OFFSET_MINUTES = 330; // Asia/Kolkata. No daylight saving, ever.

/** Minutes past midnight in the shop's timezone, or null if we cannot tell. */
export function minutesInShopTimezone(now: Date, timezone: string | null | undefined): number | null {
  // Preferred: ask Intl. Hermes supports timeZone on both platforms.
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone ?? 'Asia/Kolkata',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(now);

    const hour = Number(parts.find((part) => part.type === 'hour')?.value);
    const minute = Number(parts.find((part) => part.type === 'minute')?.value);

    // Intl can hand back "24" for midnight in some engines.
    if (Number.isFinite(hour) && Number.isFinite(minute)) {
      return (hour % 24) * 60 + minute;
    }
  } catch {
    // Fall through to the arithmetic below.
  }

  // Fallback: Kunigal is UTC+5:30 all year, so this is exact for this shop.
  const utcMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  return (utcMinutes + IST_OFFSET_MINUTES) % (24 * 60);
}

/** "18:30:00" -> 1110 */
function timeToMinutes(time: string | null): number | null {
  if (!time) return null;
  const match = /^(\d{1,2}):(\d{2})/.exec(time);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

export function isStoreOpen(
  settings: Pick<StoreSettings, 'is_open' | 'open_time' | 'close_time' | 'timezone'> | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!settings) return true; // Unknown: let the database be the judge.
  if (!settings.is_open) return false;

  const opens = timeToMinutes(settings.open_time);
  const closes = timeToMinutes(settings.close_time);
  if (opens === null || closes === null) return true;

  const nowMinutes = minutesInShopTimezone(now, settings.timezone);
  if (nowMinutes === null) return true;

  if (opens <= closes) return nowMinutes >= opens && nowMinutes < closes;

  // Overnight, e.g. open 22:00 and shut 02:00.
  return nowMinutes >= opens || nowMinutes < closes;
}