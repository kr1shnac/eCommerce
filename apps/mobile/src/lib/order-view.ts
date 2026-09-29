/**
 * Orders snapshot the delivery address as jsonb at the moment they are placed,
 * so editing the address later never rewrites where a past order went. The `Order`
 * type calls that column `Record<string, unknown>`, which is honest but useless to
 * render. This is the one place that turns it back into something a screen can
 * show, so the rider, the owner and the customer read the same address the same
 * way. Three screens used to join it by hand; they drifted.
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

/**
 * Read the snapshot address out of an order row.
 *
 * The parameter is deliberately loose — `unknown` in the field's position rather
 * than the `jsonb` type — because callers hand it different shapes: the rider
 * screen passes an `Order`, the customer screen passes an `OrderWithItems`, and a
 * screen with no data yet passes a stand-in. All of them have the column, and the
 * value itself is `jsonb`, so the only safe thing to do is check at runtime, which
 * is what the body does. Typing the parameter as `Pick<Order, ...>` was the first
 * version and it rejected the customer screen for no real reason.
 */
export function readSnapshotAddress(order: {
  delivery_address?: unknown;
}): SnapshotAddress {
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
 * The rider's view of an address, which is a different question from the
 * customer's.
 *
 * A customer reads their own address and knows where they live; the sentence is
 * a reminder. A **rider is trying to find a house in a town that has no reliable
 * street numbering**, standing on a bike — for them the landmark is not a detail
 * in a comma list, it is the actual instruction, and the house number is the part
 * that may not exist. So the landmark is pulled out to the front and the rest is
 * the supporting detail.
 *
 * `landmark` is null whenever the customer did not give one, which is common
 * (the field is optional). The caller is expected to fall back to the plain
 * sentence in that case rather than rendering an empty heading — see
 * `hasLandmark`.
 */
export function splitSnapshotAddress(address: SnapshotAddress): {
  /** The thing to look for — "the big banyan tree". Null when none was given. */
  landmark: string | null;
  /** House, street, town, pincode — everything that is not the landmark. */
  rest: string;
} {
  const landmark = address.landmark?.trim() || null;
  const rest = [
    address.line1,
    address.line2,
    [address.city, address.pincode].filter(Boolean).join(' '),
  ]
    .filter(Boolean)
    .join(', ');

  return { landmark, rest };
}

/** True when there is a landmark worth leading with. */
export function hasLandmark(address: SnapshotAddress): boolean {
  return Boolean(address.landmark?.trim());
}

/** The phone number in a shape `tel:` accepts — digits only, 10+ of them. */
export function dialablePhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '');
  return digits.length >= 10 ? digits : null;
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
