// =============================================================================
// POST /razorpay-order
//
// The app has an order row. This function creates the PAYABLE object for it:
// a Razorpay order for the exact total the database stored. The client never
// sends an amount, and if it did, it would be ignored.
//
// One payable object per basket. A second call returns the id already stored
// instead of creating another, so a double tap cannot start two payments.
//
// Auth: Supabase's JWT gate plus an explicit getUser(). The order is read with
// the CUSTOMER's client, so RLS decides whether it exists for them.
// =============================================================================

import {
  ConfigError,
  createUserClient,
  env,
  json,
  preflight,
  razorpayFailure,
  razorpayRequest,
} from '../_shared/razorpay.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return preflight();
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  try {
    const client = createUserClient(req);
    if (!client) return json({ error: 'not_signed_in' }, 401);

    const { data: authData, error: authError } = await client.auth.getUser();
    if (authError || !authData.user) return json({ error: 'not_signed_in' }, 401);
    const user = authData.user;

    let body: { order_id?: unknown } = {};
    try {
      body = await req.json();
    } catch {
      return json({ error: 'bad_request' }, 400);
    }

    const orderId = typeof body.order_id === 'string' ? body.order_id : '';
    if (!UUID.test(orderId)) return json({ error: 'bad_request' }, 400);

    const { data: order, error: orderError } = await client
      .from('orders')
      .select(
        'id, user_id, store_id, order_number, status, payment_method, payment_status, total_paise, payment_provider_order_id',
      )
      .eq('id', orderId)
      .maybeSingle();

    if (orderError) {
      console.error('razorpay-order: order read failed', orderError.message);
      return json({ error: 'order_unavailable' }, 500);
    }
    if (!order) return json({ error: 'order_not_found' }, 404);
    if (order.user_id !== user.id) return json({ error: 'not_your_order' }, 403);
    if (order.payment_method === 'cod') return json({ error: 'cash_order' }, 409);
    if (order.status !== 'placed') return json({ error: 'order_closed' }, 409);
    if (order.payment_status !== 'pending') return json({ error: 'already_settled' }, 409);
    if (!Number.isInteger(order.total_paise) || order.total_paise <= 0) {
      return json({ error: 'nothing_to_pay' }, 409);
    }

    let gatewayOrderId = order.payment_provider_order_id as string | null;

    if (!gatewayOrderId) {
      const created = await razorpayRequest('/orders', {
        method: 'POST',
        body: JSON.stringify({
          amount: order.total_paise,
          currency: 'INR',
          receipt: order.order_number,
          notes: {
            kunigal_order_id: order.id,
            customer_id: user.id,
          },
        }),
      });

      if (!created.ok) {
        console.error('razorpay-order: create failed', created.status, razorpayFailure(created));
        return json({ error: 'gateway_error' }, 502);
      }

      const createdId = created.body?.id;
      if (typeof createdId !== 'string' || !createdId.startsWith('order_')) {
        console.error('razorpay-order: create returned no order id');
        return json({ error: 'gateway_error' }, 502);
      }
      gatewayOrderId = createdId;

      const { error: intentError } = await client.rpc('set_order_payment_intent', {
        p_order_id: order.id,
        p_provider_order_id: gatewayOrderId,
      });

      if (intentError) {
        // Two taps raced. The loser's gateway order was never paid (no checkout
        // was opened for it) and is abandoned. Use the id that won the row.
        const { data: again } = await client
          .from('orders')
          .select('payment_provider_order_id')
          .eq('id', order.id)
          .maybeSingle();

        const stored = again?.payment_provider_order_id as string | null;
        if (!stored) {
          console.error('razorpay-order: intent failed', intentError.message);
          return json({ error: 'payment_start_failed' }, 500);
        }
        gatewayOrderId = stored;
      }
    }

    // The payment sheet's name and prefill come from the shop and the customer's
    // own profile, not from the app, so a tampered client cannot mislabel them.
    const [{ data: store }, { data: profile }] = await Promise.all([
      client.from('stores').select('name_en').eq('id', order.store_id).maybeSingle(),
      client.from('profiles').select('full_name, phone').eq('id', user.id).maybeSingle(),
    ]);

    return json({
      ok: true,
      key_id: env('RAZORPAY_KEY_ID'),
      gateway_order_id: gatewayOrderId,
      order_id: order.id,
      order_number: order.order_number,
      amount: order.total_paise,
      currency: 'INR',
      name: (store?.name_en as string | undefined) ?? 'Kunigal Bazaar',
      description: `Order ${order.order_number}`,
      prefill: {
        name: (profile?.full_name as string | undefined) ?? '',
        contact: (profile?.phone as string | undefined) ?? user.phone ?? '',
      },
    });
  } catch (error) {
    if (error instanceof ConfigError) {
      console.error('razorpay-order: not configured', error.message);
      return json({ error: 'gateway_not_configured' }, 503);
    }
    console.error('razorpay-order: unhandled', error);
    return json({ error: 'server_error' }, 500);
  }
});
