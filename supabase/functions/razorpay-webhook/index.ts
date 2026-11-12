// =============================================================================
// POST /razorpay-webhook
//
// The safety net. The app can be killed, lose signal, or lie; Razorpay's own
// event is the fact that money moved. This function verifies the webhook
// signature over the RAW body with the webhook secret, then settles the same
// way the app's verify call does.
//
// Deploy with `--no-verify-jwt`: Razorpay does not carry a Supabase JWT. The
// signature IS the authentication, which is why it is checked before the body
// is parsed as JSON.
//
// Retries: 200 means "handled or deliberately ignored", so Razorpay stops.
// 4xx/5xx means "look at this", so Razorpay retries — used only where a retry
// could actually help or a human must see it.
// =============================================================================

import {
  ConfigError,
  createAdminClient,
  env,
  hmacSha256Hex,
  json,
  preflight,
  timingSafeEqual,
} from '../_shared/razorpay.ts';

type Entity = Record<string, unknown>;

function asEntity(value: unknown): Entity {
  return value && typeof value === 'object' ? (value as Entity) : {};
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return preflight();
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  try {
    const raw = await req.text();
    const signature = (req.headers.get('X-Razorpay-Signature') ?? '').trim();
    if (!signature) return json({ error: 'bad_signature' }, 400);

    const expected = await hmacSha256Hex(env('RAZORPAY_WEBHOOK_SECRET'), raw);
    if (!timingSafeEqual(expected, signature)) {
      console.error('razorpay-webhook: signature mismatch');
      return json({ error: 'bad_signature' }, 400);
    }

    let event: Entity;
    try {
      event = JSON.parse(raw) as Entity;
    } catch {
      return json({ error: 'bad_request' }, 400);
    }

    const eventName = str(event.event);
    if (eventName !== 'payment.captured' && eventName !== 'order.paid') {
      return json({ ok: true, ignored: eventName || 'unknown_event' });
    }

    const payload = asEntity(event.payload);
    const payment = asEntity(payload.payment ? asEntity(payload.payment).entity : null);
    const gatewayOrder = asEntity(payload.order ? asEntity(payload.order).entity : null);

    const gatewayOrderId = str(payment.order_id) || str(gatewayOrder.id);
    const paymentId = str(payment.id);
    const amount = Number(payment.amount);

    if (!gatewayOrderId || !paymentId) {
      return json({ ok: true, ignored: 'no_ids' });
    }

    const admin = createAdminClient();
    const { data: order, error: orderError } = await admin
      .from('orders')
      .select('id, total_paise, payment_status, status')
      .eq('payment_provider_order_id', gatewayOrderId)
      .maybeSingle();

    if (orderError) {
      console.error('razorpay-webhook: order read failed', orderError.message);
      return json({ error: 'order_unavailable' }, 500);
    }
    if (!order) {
      // Not one of ours (or an abandoned intent). Nothing to do.
      return json({ ok: true, ignored: 'unknown_order' });
    }

    if (order.payment_status === 'paid') {
      return json({ ok: true, ignored: 'already_paid', order_id: order.id });
    }

    if (!Number.isFinite(amount) || amount !== order.total_paise) {
      console.error('razorpay-webhook: amount mismatch', {
        orderId: order.id,
        captured: amount,
        expected: order.total_paise,
      });
      return json({ error: 'amount_mismatch' }, 409);
    }

    const { error: settleError } = await admin.rpc('settle_online_payment', {
      p_order_id: order.id,
      p_payment_id: paymentId,
    });

    if (settleError) {
      const code = (settleError as { code?: string }).code ?? '';
      console.error('razorpay-webhook: settle refused', code, settleError.message);
      if (code === '23505') return json({ error: 'already_paid_other_reference' }, 409);
      if (code === 'P0002') return json({ ok: true, ignored: 'order_deleted' });
      return json({ error: 'settle_failed' }, 500);
    }

    return json({ ok: true, order_id: order.id, payment_status: 'paid' });
  } catch (error) {
    if (error instanceof ConfigError) {
      console.error('razorpay-webhook: not configured', error.message);
      return json({ error: 'gateway_not_configured' }, 503);
    }
    console.error('razorpay-webhook: unhandled', error);
    return json({ error: 'server_error' }, 500);
  }
});
