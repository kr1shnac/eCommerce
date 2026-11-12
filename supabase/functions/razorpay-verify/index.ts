// =============================================================================
// POST /razorpay-verify
//
// The checkout sheet closed with a success. That is a CLAIM by the app, not a
// fact: this function recomputes the HMAC over `order_id|payment_id` with the
// key secret and only then asks the database to record the payment.
//
// Two bindings are checked before the signature is even trusted:
//   * the local order belongs to the signed-in user;
//   * the Razorpay order id is the one stored on that local order — otherwise a
//     signature earned on a different (cheap) order could be replayed here.
//
// The write goes through `settle_online_payment()`, which is service_role only
// and is idempotent for the same payment id.
// =============================================================================

import {
  ConfigError,
  createAdminClient,
  createUserClient,
  env,
  hmacSha256Hex,
  json,
  preflight,
  timingSafeEqual,
} from '../_shared/razorpay.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ORDER_ID = /^order_[A-Za-z0-9]+$/;
const PAYMENT_ID = /^pay_[A-Za-z0-9]+$/;

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return preflight();
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  try {
    const client = createUserClient(req);
    if (!client) return json({ error: 'not_signed_in' }, 401);

    const { data: authData, error: authError } = await client.auth.getUser();
    if (authError || !authData.user) return json({ error: 'not_signed_in' }, 401);
    const user = authData.user;

    let body: Record<string, unknown> = {};
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      return json({ error: 'bad_request' }, 400);
    }

    const orderId = text(body.order_id);
    const gatewayOrderId = text(body.razorpay_order_id);
    const paymentId = text(body.razorpay_payment_id);
    const signature = text(body.razorpay_signature);

    if (!UUID.test(orderId) || !ORDER_ID.test(gatewayOrderId) || !PAYMENT_ID.test(paymentId)) {
      return json({ error: 'bad_request' }, 400);
    }
    if (!signature) return json({ error: 'bad_signature' }, 400);

    const admin = createAdminClient();

    const { data: order, error: orderError } = await admin
      .from('orders')
      .select('id, user_id, payment_provider_order_id, payment_status, status')
      .eq('id', orderId)
      .maybeSingle();

    if (orderError) {
      console.error('razorpay-verify: order read failed', orderError.message);
      return json({ error: 'order_unavailable' }, 500);
    }
    if (!order) return json({ error: 'order_not_found' }, 404);
    if (order.user_id !== user.id) return json({ error: 'not_your_order' }, 403);
    if (order.payment_provider_order_id !== gatewayOrderId) {
      return json({ error: 'order_mismatch' }, 409);
    }

    const expected = await hmacSha256Hex(
      env('RAZORPAY_KEY_SECRET'),
      `${gatewayOrderId}|${paymentId}`,
    );
    if (!timingSafeEqual(expected, signature)) {
      console.error('razorpay-verify: signature mismatch', { orderId, gatewayOrderId });
      return json({ error: 'bad_signature' }, 400);
    }

    const { data: settled, error: settleError } = await admin.rpc('settle_online_payment', {
      p_order_id: orderId,
      p_payment_id: paymentId,
    });

    if (settleError) {
      const code = (settleError as { code?: string }).code ?? '';
      console.error('razorpay-verify: settle refused', code, settleError.message);
      if (code === '23505') return json({ error: 'already_paid_other_reference' }, 409);
      if (code === '22023') return json({ error: 'settle_refused' }, 409);
      if (code === 'P0002') return json({ error: 'order_not_found' }, 404);
      return json({ error: 'settle_failed' }, 500);
    }

    return json({
      ok: true,
      order_id: orderId,
      payment_status: (settled as { payment_status?: string } | null)?.payment_status ?? 'paid',
      refund_due_paise: (settled as { refund_due_paise?: number } | null)?.refund_due_paise ?? 0,
    });
  } catch (error) {
    if (error instanceof ConfigError) {
      console.error('razorpay-verify: not configured', error.message);
      return json({ error: 'gateway_not_configured' }, 503);
    }
    console.error('razorpay-verify: unhandled', error);
    return json({ error: 'server_error' }, 500);
  }
});
