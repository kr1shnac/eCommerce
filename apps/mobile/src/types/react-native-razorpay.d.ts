/**
 * Types for the native Razorpay checkout module (`react-native-razorpay` v3).
 *
 * The package ships no declarations, and `@types/` would be a stub that says
 * `any` — which is exactly what hides a renamed option. These mirror the public
 * API the wrapper documents.
 *
 * Two things worth pinning down, because they are the ones that cost money:
 *
 *   * `amount` is a STRING of paise, never a number and never a decimal. A
 *     float here rounds to the wrong amount (AGENTS.md rule 1).
 *   * `open()` resolves only on a completed payment. A dismissed sheet is a
 *     REJECTION, never a resolve with no fields — so the caller may treat "I
 *     got a payment id" as true and "I got nothing" as not-paid.
 */

declare module 'react-native-razorpay' {
  /** What a completed checkout resolves with. */
  export type RazorpaySuccess = {
    razorpay_signature: string;
    razorpay_order_id: string;
    razorpay_payment_id: string;
  };

  /** What a failed or dismissed checkout rejects with. */
  export type RazorpayFailure = {
    code: number | string;
    description: string;
  };

  export type RazorpayOptions = {
    /** The public key id. Publishable by design. */
    key: string;
    /** Amount in PAISE, as a string. */
    amount: string;
    currency?: string;
    /** The gateway order id created server-side for this basket. */
    order_id: string;
    name?: string;
    description?: string;
    prefill?: {
      name?: string;
      contact?: string;
      email?: string;
    };
    theme?: {
      color?: string;
    };
    image?: string;
    notes?: Record<string, string>;
    /** Razorpay can retry a failed payment inside the sheet. */
    retry?: { enabled?: boolean; max_count?: number };
  };

  export type RazorpayCheckoutModule = {
    open: (options: RazorpayOptions) => Promise<RazorpaySuccess>;
  };

  export const Razorpay: RazorpayCheckoutModule;

  const RazorpayCheckout: RazorpayCheckoutModule & {
    change?: (params: Record<string, unknown>) => void;
  };

  export default RazorpayCheckout;
}
