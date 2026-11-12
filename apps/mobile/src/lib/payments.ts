import type { PaymentMethod } from '@/types/database';

/**
 * The payment half of the app: what the server says about money, turned into
 * something the app can show.
 *
 * Nothing here touches the network or the gateway. The gateway is opened by the
 * hook (`src/hooks/use-online-payment.ts`); this module only decides what the
 * words are, so a missing key shows up in a script rather than as a raw
 * `pay.error.gateway_error` string on a customer's phone.
 */

/** True for every method that is not cash, including the legacy `online`. */
export function isOnlinePaymentMethod(method: PaymentMethod): boolean {
  return method !== 'cod';
}

/**
 * Every code the three Edge Functions can answer with.
 *
 * `scripts/check-payments.mjs` greps these out of `supabase/functions/` and
 * fails the build if one of them has no key in BOTH locales. A missing Kannada
 * key is a raw key string on a real customer's phone (AGENTS.md rule 9.5).
 */
export const ONLINE_PAYMENT_ERRORS = [
  // What the three Edge Functions answer with.
  'not_signed_in',
  'bad_request',
  'method_not_allowed',
  'order_not_found',
  'not_your_order',
  'cash_order',
  'order_closed',
  'already_settled',
  'nothing_to_pay',
  'gateway_error',
  'payment_start_failed',
  'order_unavailable',
  'order_mismatch',
  'bad_signature',
  'settle_refused',
  'already_paid_other_reference',
  'settle_failed',
  'amount_mismatch',
  'gateway_not_configured',
  'server_error',
  // What the app itself says.
  'network',
  'cancelled',
  'not_installed',
  'unknown',
] as const;

export type OnlinePaymentErrorCode = (typeof ONLINE_PAYMENT_ERRORS)[number];

/**
 * Codes that are ours, not the customer's: a naive retry cannot fix them, and
 * the customer should be told who to speak to instead.
 */
export const UNRECOVERABLE_PAYMENT_ERRORS = [
  'gateway_not_configured',
  'gateway_error',
  'settle_failed',
  'amount_mismatch',
  'order_mismatch',
] as const;

/** Money may still be on its way; the order screen offers a "Pay now". */
export const RETRYABLE_PAYMENT_ERRORS = [
  'bad_signature',
  'already_paid_other_reference',
  'payment_start_failed',
  'order_unavailable',
] as const;

/** The i18n key for a gateway answer, always known to exist. */
export function onlinePaymentErrorKey(code: string | null | undefined): string {
  return (ONLINE_PAYMENT_ERRORS as readonly string[]).includes(code ?? '')
    ? `pay.error.${code}`
    : 'pay.error.unknown';
}

/** A code that means the sheet closed without money moving. */
export function isCustomerCancellation(code: string): boolean {
  return code === 'cancelled';
}

/** True when the order is live, unpaid and not cash: it can still be paid. */
export function canPayOnline(order: {
  status: string;
  payment_method: PaymentMethod;
  payment_status: string;
}): boolean {
  return (
    isOnlinePaymentMethod(order.payment_method) &&
    order.payment_status === 'pending' &&
    (order.status === 'placed' || order.status === 'confirmed' || order.status === 'packing')
  );
}
