import * as Crypto from 'expo-crypto';

/**
 * The idempotency key for one checkout attempt.
 *
 * Generated ONCE, before the first `place_order` call, and then reused for
 * every retry of that same attempt. If it changed on each retry, a dropped
 * connection would look like a brand-new order and the customer would be
 * charged (and the shop would pack) twice.
 *
 * A fresh key is only correct when the BASKET changes — see the
 * `items_unavailable` path in checkout.tsx.
 */
export function makeIdempotencyKey(): string {
  return `app-${Crypto.randomUUID()}`;
}