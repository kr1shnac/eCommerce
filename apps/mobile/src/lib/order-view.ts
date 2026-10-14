import type { Order } from '@/types/database';

/**
 * Orders snapshot the delivery address as jsonb at the moment they are placed,
 * so editing the address later never rewrites where a past order went. `Order`
 * types that column as `Record<string, unknown>`, which is honest but useless to
 * render. This is the one place that turns it back into something a screen can
 * show, so the rider and the owner read the same address the same way.
 */
export type SnapshotAddress = {
  full_name?: string;
  phone?: string;
  line1?: string;
  line2?: string;
  landmark?: string;
  city?: string;
  pincode?: string;
};

export function readSnapshotAddress(order: Pick<Order, 'delivery_address'>): SnapshotAddress {
  const value = order.delivery_address;
  if (!value || typeof value !== 'object') return {};
  return value as SnapshotAddress;
}

/** "No. 12, Main Road, near the temple, Kunigal 572130" — skipping the empty bits. */
export function formatSnapshotAddress(address: SnapshotAddress, nearWord = 'Near'): string {
  return [
    address.line1,
    address.line2,
    address.landmark ? `${nearWord} ${address.landmark}` : null,
    [address.city, address.pincode].filter(Boolean).join(' '),
  ]
    .filter(Boolean)
    .join(', ');
}

/**
 * 24-hour, day/month. Hand-rolled rather than Intl: Intl output is not identical
 * across Hermes/Android/iOS, and "25/10, 21:05" is read the same in Kunigal in
 * either language.
 */
export function formatClock(value: string | null | undefined): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}, ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Whole minutes since a timestamp, never negative. Used for "waiting 12 min". */
export function minutesSince(value: string | null | undefined): number {
  if (!value) return 0;
  const then = new Date(value).getTime();
  if (Number.isNaN(then)) return 0;
  return Math.max(0, Math.floor((Date.now() - then) / 60_000));
}

/** True when two timestamps fall on the same local calendar day. */
export function isSameDay(a: string | null | undefined, b: Date): boolean {
  if (!a) return false;
  const date = new Date(a);
  if (Number.isNaN(date.getTime())) return false;
  return (
    date.getFullYear() === b.getFullYear() &&
    date.getMonth() === b.getMonth() &&
    date.getDate() === b.getDate()
  );
}
