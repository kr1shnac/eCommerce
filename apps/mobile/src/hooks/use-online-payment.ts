import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Platform } from 'react-native';
import type {
  RazorpayCheckoutModule,
  RazorpayOptions,
  RazorpaySuccess,
} from 'react-native-razorpay';

import { supabase } from '@/lib/supabase';
import { orderKeys } from '@/hooks/use-orders';

/**
 * Paying an order for real, the way Blinkit and Zepto do it: the green button
 * places the order, the gateway's sheet opens over it, and success is confirmed
 * by a server that checked Razorpay's signature — never by the app saying so.
 *
 * Three facts this module protects:
 *
 *   1. The amount and the payable object come from the Edge Function, which
 *      reads the total out of the database. The app cannot name a price.
 *   2. `razorpay-verify` re-checks the HMAC before the database records
 *      anything, so a forged "I paid" is a 400.
 *   3. If the sheet is dismissed or the network drops, the order survives and
 *      the customer is offered "Pay now" again. Money is never cancelled by a
 *      guess — the webhook settles a capture the app never heard about, and the
 *      database turns that into a refund the customer can see.
 *
 * `react-native-razorpay` is native, so it is imported lazily and never
 * required on web (see AGENTS.md: nothing native may reach the static export).
 */

export class OnlinePaymentFailed extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = 'OnlinePaymentFailed';
    this.code = code;
  }
}

type StartPaymentResponse = {
  ok: boolean;
  key_id: string;
  gateway_order_id: string;
  order_number: string;
  /** Paise, as an integer — exactly what the database stored. */
  amount: number;
  currency: string;
  name: string;
  description: string;
  prefill: { name?: string; contact?: string };
};

async function callEdgeFunction<T>(name: string, body: unknown): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const session = data.session;
  if (!session) throw new OnlinePaymentFailed('not_signed_in');

  const url = `${process.env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1/${name}`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
        apikey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '',
      },
      body: JSON.stringify(body),
    });
  } catch (error) {
    // Offline or the gateway is down. An ordinary state, not a crash (rule 9.3).
    console.warn('[payment] could not reach the gateway function', error);
    throw new OnlinePaymentFailed('network');
  }

  const payload = (await response.json().catch(() => null)) as
    | { error?: string }
    | null;

  if (!response.ok) {
    throw new OnlinePaymentFailed(payload?.error ?? 'unknown');
  }
  return payload as T;
}

async function loadRazorpay(): Promise<RazorpayCheckoutModule> {
  if (Platform.OS !== 'android' && Platform.OS !== 'ios') {
    throw new OnlinePaymentFailed('not_installed');
  }
  // Lazy on purpose: this module touches NativeModules at load time, so it must
  // never be in the web bundle's entry graph (AGENTS.md).
  const module = await import('react-native-razorpay');
  const checkout = module.default;
  if (!checkout || typeof checkout.open !== 'function') {
    throw new OnlinePaymentFailed('not_installed');
  }
  return checkout;
}

export type PayOnlineInput = {
  orderId: string;
  /** Brand colour for the sheet, so it looks like the shop, not a bank page. */
  themeColor?: string;
};

export type PayOnlineResult = {
  orderId: string;
  paymentId: string;
};

/**
 * One basket, one payment: create the gateway order, open the sheet, verify the
 * signature server-side. Safe to run twice — the same Razorpay order id is
 * stored once, and settling the same payment id is a no-op.
 */
export function useOnlinePayment() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: PayOnlineInput): Promise<PayOnlineResult> => {
      const start = await callEdgeFunction<StartPaymentResponse>('razorpay-order', {
        order_id: input.orderId,
      });

      const checkout = await loadRazorpay();

      let success: RazorpaySuccess;
      try {
        success = await checkout.open({
          key: start.key_id,
          // Paise, as Razorpay expects it. Never a float, never a decimal
          // string (AGENTS.md rule 1).
          amount: String(start.amount),
          currency: start.currency ?? 'INR',
          order_id: start.gateway_order_id,
          name: start.name,
          description: start.description,
          prefill: {
            name: start.prefill?.name ?? '',
            contact: start.prefill?.contact ?? '',
          },
          theme: input.themeColor ? { color: input.themeColor } : undefined,
        } satisfies RazorpayOptions);
      } catch (error) {
        // The sheet closed on purpose, or the app was backgrounded. Money did
        // not move as far as we know; the order stays payable.
        console.warn('[payment] the sheet closed', error);
        throw new OnlinePaymentFailed('cancelled');
      }

      const paymentId = success?.razorpay_payment_id ?? '';
      if (!paymentId || !success?.razorpay_order_id || !success.razorpay_signature) {
        throw new OnlinePaymentFailed('bad_signature');
      }

      const verified = await callEdgeFunction<{ ok: boolean }>('razorpay-verify', {
        order_id: input.orderId,
        razorpay_order_id: success.razorpay_order_id,
        razorpay_payment_id: paymentId,
        razorpay_signature: success.razorpay_signature,
      });

      if (!verified?.ok) throw new OnlinePaymentFailed('bad_signature');

      return { orderId: input.orderId, paymentId };
    },
    onSuccess: async (result) => {
      // The money is recorded: the order row, the list and any invoice behind
      // it are all stale now.
      await queryClient.invalidateQueries({ queryKey: orderKeys.detail(result.orderId) });
      await queryClient.invalidateQueries({ queryKey: orderKeys.list });
    },
  });
}
