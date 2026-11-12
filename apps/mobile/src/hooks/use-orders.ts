import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useCartStore } from '@/store/cart-store';
import { supabase } from '@/lib/supabase';
import type {
  ActiveOffer,
  Address,
  CancelOrderResult,
  CouponValidationResult,
  DeliveryCodeResult,
  ExpressRefusalReason,
  Order,
  OrderItem,
  PaymentMethod,
  PlaceOrderError as PlaceOrderErrorCode,
  PlaceOrderResult,
  UnavailableItem,
} from '@/types/database';

/**
 * place_order() reports refusal as `{ ok: false, error }` inside a 200 response,
 * because the refusal is a normal answer and must not look like a crash. The app
 * turns it into a thrown error so `try/catch` and `isPending` behave normally,
 * while keeping the machine-readable code for the right translated message.
 */
export class PlaceOrderRejected extends Error {
  readonly code: PlaceOrderErrorCode;
  readonly items: UnavailableItem[];
  readonly minOrderPaise: number | null;
  /** Smallest basket the applied COUPON accepts, when it is the reason. */
  readonly couponMinOrderPaise: number | null;
  /** On `outside_delivery_radius`: the measured distance and the shop's radius. */
  readonly distanceM: number | null;
  readonly radiusM: number | null;
  /** On `express_not_available`: why, and the numbers that explain it. */
  readonly expressReason: ExpressRefusalReason | null;
  readonly expressRadiusM: number | null;
  readonly units: number | null;
  readonly maxUnits: number | null;

  constructor(result: Extract<PlaceOrderResult, { ok: false }>) {
    super(result.error);
    this.name = 'PlaceOrderRejected';
    this.code = result.error;
    this.items = result.items ?? [];
    this.minOrderPaise = result.min_order_value_paise ?? null;
    this.couponMinOrderPaise = result.min_order_paise ?? null;
    this.distanceM = result.distance_m ?? null;
    this.radiusM = result.radius_m ?? null;
    this.expressReason = result.reason ?? null;
    this.expressRadiusM = result.express_radius_m ?? null;
    this.units = result.units ?? null;
    this.maxUnits = result.max_units ?? null;
  }
}

export class CancelOrderRejected extends Error {
  readonly result: Extract<CancelOrderResult, { ok: false }>;

  constructor(result: Extract<CancelOrderResult, { ok: false }>) {
    super(result.error);
    this.name = 'CancelOrderRejected';
    this.result = result;
  }
}

/**
 * Addresses, and orders.
 *
 * Orders are only ever WRITTEN by the database functions `place_order` and
 * `cancel_order`. There is deliberately no `.insert()` or `.update()` on the
 * orders table anywhere in this app: see AGENTS.md rule 9.1.
 */

export type OrderWithItems = Order & { order_items: OrderItem[] };

export const orderKeys = {
  list: ['orders'] as const,
  detail: (id: string) => ['orders', id] as const,
  deliveryCode: (id: string) => ['orders', id, 'delivery-code'] as const,
};

const ORDER_SELECT = '*, order_items(*)';

// -----------------------------------------------------------------------------
// Addresses
// -----------------------------------------------------------------------------

export const addressKeys = {
  list: ['addresses'] as const,
};

export function useAddresses(options?: { enabled?: boolean }) {
  return useQuery<Address[]>({
    queryKey: addressKeys.list,
    // Home asks for the default address only when somebody is signed in; asking
    // while signed out would just be a wasted round trip that returns no rows.
    enabled: options?.enabled ?? true,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('addresses')
        .select('*')
        .order('is_default', { ascending: false })
        .order('created_at', { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });
}

export type NewAddress = {
  label: string;
  full_name: string;
  phone: string;
  line1: string;
  line2?: string | null;
  landmark?: string | null;
  city: string;
  pincode: string;
  is_default?: boolean;
  /**
   * The door pin, dropped on the map (`addresses.lat/lng`, migration
   * 20261107000001). Optional because an address is still perfectly good
   * without one — the landmark text has worked for years — and because the
   * column is nullable: an update carrying `null` deliberately clears the pin,
   * which is what "remove this" means.
   */
  lat?: number | null;
  lng?: number | null;
};

/**
 * Save an address, then make it the first one if it is the customer's only one.
 * Kept idempotent-ish: an error leaves the list untouched rather than half-saved.
 */
export function useAddAddress() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (address: NewAddress) => {
      const { data, error } = await supabase
        .from('addresses')
        .insert(address)
        .select('*')
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: addressKeys.list });
    },
  });
}

/**
 * Change a saved address. Only the fields passed are written, so a phone number
 * edit cannot accidentally blank the landmark.
 */
export function useUpdateAddress() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, ...changes }: { id: string } & Partial<NewAddress>) => {
      const { data, error } = await supabase
        .from('addresses')
        .update(changes)
        .eq('id', id)
        .select('*')
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: addressKeys.list });
    },
  });
}

export function useDeleteAddress() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('addresses').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: addressKeys.list });
    },
  });
}

/**
 * Promote an address to the default. Delegated to the database function so the
 * "clear the old one, set the new one" happens in one transaction — a
 * client-side two-step would briefly have zero defaults or trip the unique index.
 */
export function useSetDefaultAddress() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase.rpc('set_default_address', { p_address_id: id });
      if (error) throw error;
      return data;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: addressKeys.list });
    },
  });
}

// -----------------------------------------------------------------------------
// Orders
// -----------------------------------------------------------------------------

export function useOrders(options?: { enabled?: boolean }) {
  return useQuery<OrderWithItems[]>({
    queryKey: orderKeys.list,
    enabled: options?.enabled ?? true,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('orders')
        .select(ORDER_SELECT)
        .order('placed_at', { ascending: false })
        .limit(30);
      if (error) throw error;
      return (data ?? []) as OrderWithItems[];
    },
  });
}

export function useOrder(id: string | null) {
  return useQuery<OrderWithItems>({
    queryKey: orderKeys.detail(id ?? 'none'),
    enabled: Boolean(id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('orders')
        .select(ORDER_SELECT)
        .eq('id', id as string)
        .single();
      if (error) throw error;
      return data as OrderWithItems;
    },
  });
}

/**
 * The customer's own four-digit handover code.
 *
 * Deliberately a separate query from the order: the code lives in a table no
 * client can read (migration 20261106000003) and is only meaningful while the
 * bag is out for delivery, so the card asks for it separately and shows
 * nothing when the server answers `not_available`. The rider is refused by the
 * function itself; this hook is only ever mounted for the order's own customer.
 */
export function useDeliveryCode(orderId: string | null, options?: { enabled?: boolean }) {
  return useQuery<DeliveryCodeResult>({
    queryKey: orderKeys.deliveryCode(orderId ?? 'none'),
    enabled: Boolean(orderId) && (options?.enabled ?? true),
    // The code is spent the moment the order is delivered, so a cached answer
    // would show a dead code. Always ask the server.
    staleTime: 0,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('my_delivery_code', {
        p_order_id: orderId as string,
      });
      if (error) throw error;
      if (!data || typeof data !== 'object') throw new Error('bad-delivery-code-response');
      return data as DeliveryCodeResult;
    },
  });
}

/**
 * Place an order. The `idempotencyKey` must be generated ONCE per checkout
 * attempt and reused for every retry of that attempt, otherwise a retry after a
 * dropped connection would create a second order (rule 9.4).
 */
export function usePlaceOrder() {
  const queryClient = useQueryClient();
  const clearCart = useCartStore((state) => state.clear);

  return useMutation({
    mutationFn: async (input: {
      storeId: string;
      addressId: string;
      note: string | null;
      idempotencyKey: string;
      couponCode?: string | null;
      /** The method the customer picked. The database refuses one it cannot collect. */
      paymentMethod?: PaymentMethod;
      /** The 30-minute promise, only when the quote said it was available. */
      express?: boolean;
    }): Promise<Extract<PlaceOrderResult, { ok: true }>> => {
      const items = Object.entries(useCartStore.getState().items).map(([product_id, quantity]) => ({
        product_id,
        quantity,
      }));

      const { data, error } = await supabase.rpc('place_order', {
        p_items: items,
        p_store_id: input.storeId,
        p_address_id: input.addressId,
        p_idempotency_key: input.idempotencyKey,
        p_note: input.note,
        // The code only. The discount comes back from the database.
        p_coupon_code: input.couponCode ?? null,
        // Both are re-checked server-side; sending them only states the intent.
        p_payment_method: input.paymentMethod ?? 'cod',
        p_express: input.express ?? false,
      });

      if (error) throw error;
      // The function always returns jsonb; guard anyway rather than crash.
      if (!data || typeof data !== 'object') throw new Error('bad-place-order-response');
      if (!data.ok) throw new PlaceOrderRejected(data);
      return data;
    },
    onSuccess: async () => {
      // The bag has been bought. Never leave a stale basket behind.
      clearCart();
      await queryClient.invalidateQueries({ queryKey: orderKeys.list });
      await queryClient.invalidateQueries({ queryKey: ['cart-products'] });
    },
  });
}

export function useCancelOrder() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (orderId: string) => {
      const { data, error } = await supabase.rpc('cancel_order', { p_order_id: orderId });
      if (error) throw error;
      if (!data || typeof data !== 'object') throw new Error('bad-cancel-order-response');
      if (!data.ok) throw new CancelOrderRejected(data);
      return data;
    },
    onSuccess: async (_result, orderId) => {
      await queryClient.invalidateQueries({ queryKey: orderKeys.list });
      await queryClient.invalidateQueries({ queryKey: orderKeys.detail(orderId) });
      // Cancelling puts stock back on the shelf, so the catalogue is stale too.
      await queryClient.invalidateQueries({ queryKey: ['cart-products'] });
    },
  });
}

/**
 * The owner settles the day's cash: a rider handed over the COD money.
 *
 * The write goes through `mark_cod_collected()` because the two things that
 * matter are checked by the database, not the phone: the order must be a
 * DELIVERED COD order, and a second tap must not count the same bundle twice.
 * The mutation invalidates the order AND the shop totals, so "cash in hand"
 * and "cash collected" move on the Today tab without a manual refresh.
 */
export function useMarkCodCollected() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (orderId: string) => {
      const { data, error } = await supabase.rpc('mark_cod_collected', { p_order_id: orderId });
      if (error) throw error;
      if (!data) throw new Error('bad-mark-cod-response');
      return data;
    },
    onSuccess: async (_order, orderId) => {
      await queryClient.invalidateQueries({ queryKey: orderKeys.detail(orderId) });
      await queryClient.invalidateQueries({ queryKey: orderKeys.list });
      await queryClient.invalidateQueries({ queryKey: ['shop', 'totals'] });
    },
  });
}

/**
 * The owner records that a refund actually left the shop.
 *
 * `mark_refund_paid()` only accepts an online-paid order that was cancelled,
 * failed or returned — exactly the set `refund_due_paise` counts — so the button
 * and the liability can never disagree. Invalidating the order and the totals
 * clears the customer's refund card and the owner's Today figure together.
 */
export function useMarkRefundPaid() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (orderId: string) => {
      const { data, error } = await supabase.rpc('mark_refund_paid', { p_order_id: orderId });
      if (error) throw error;
      if (!data) throw new Error('bad-mark-refund-response');
      return data;
    },
    onSuccess: async (_order, orderId) => {
      await queryClient.invalidateQueries({ queryKey: orderKeys.detail(orderId) });
      await queryClient.invalidateQueries({ queryKey: orderKeys.list });
      await queryClient.invalidateQueries({ queryKey: ['shop', 'totals'] });
    },
  });
}

/**
 * The owner cancels an order for a customer who asked by phone.
 *
 * Cancelling puts the stock back, so the catalogue and the shop totals both
 * move. The reason is optional and travels with the order — the customer sees
 * why their order stopped, which is the difference between "cancelled" and
 * "cancelled, because your brother already brought the milk".
 */
export function useAdminCancelOrder() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: { orderId: string; reason?: string | null }) => {
      const { data, error } = await supabase.rpc('admin_cancel_order', {
        p_order_id: input.orderId,
        p_reason: input.reason ?? null,
      });
      if (error) throw error;
      if (!data) throw new Error('bad-admin-cancel-response');
      return data;
    },
    onSuccess: async (_order, input) => {
      // Stock went back on the shelf, so the catalogue is stale too.
      await queryClient.invalidateQueries({ queryKey: orderKeys.detail(input.orderId) });
      await queryClient.invalidateQueries({ queryKey: orderKeys.list });
      await queryClient.invalidateQueries({ queryKey: ['cart-products'] });
      await queryClient.invalidateQueries({ queryKey: ['shop', 'totals'] });
    },
  });
}

/**
 * The owner marks an order delivered when the rider's phone never reported back.
 *
 * Deliberately does NOT touch `payment_status`: for a COD order the money is
 * still "in the rider's pocket" until somebody hands it over and the money desk
 * records it. A status change must not quietly claim cash nobody counted.
 */
export function useAdminForceComplete() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (orderId: string) => {
      const { data, error } = await supabase.rpc('admin_force_complete', { p_order_id: orderId });
      if (error) throw error;
      if (!data) throw new Error('bad-force-complete-response');
      return data;
    },
    onSuccess: async (_order, orderId) => {
      await queryClient.invalidateQueries({ queryKey: orderKeys.detail(orderId) });
      await queryClient.invalidateQueries({ queryKey: orderKeys.list });
      await queryClient.invalidateQueries({ queryKey: ['shop', 'totals'] });
    },
  });
}

/**
 * The shop settles a shortage: one line goes down or off, the released units
 * go back on the shelf, and the database recomputes the order's totals in the
 * same transaction (migration 20261112000009). There is no "more" — a shortage
 * means less; the RPC refuses an increase and refuses to empty the order.
 *
 * The same invalidations as a cancellation: stock moved, so the catalogue is
 * stale, and the day's totals follow the order.
 */
export function useAdminAdjustOrderItem() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: { orderId: string; itemId: string; quantity: number }) => {
      const { data, error } = await supabase.rpc('admin_adjust_order_item', {
        p_order_id: input.orderId,
        p_item_id: input.itemId,
        p_quantity: input.quantity,
      });
      if (error) throw error;
      if (!data) throw new Error('bad-adjust-response');
      return data;
    },
    onSuccess: async (_order, input) => {
      await queryClient.invalidateQueries({ queryKey: orderKeys.detail(input.orderId) });
      await queryClient.invalidateQueries({ queryKey: orderKeys.list });
      await queryClient.invalidateQueries({ queryKey: ['cart-products'] });
      await queryClient.invalidateQueries({ queryKey: ['shop', 'totals'] });
    },
  });
}

// -----------------------------------------------------------------------------
// Coupons
// -----------------------------------------------------------------------------

export const offerKeys = {
  list: (storeId: string) => ['offers', storeId] as const,
};

/**
 * Ask the database what a code is worth, before placing the order.
 *
 * A mutation rather than a query: this runs when the customer taps Apply, not on
 * every render, and it must never be cached — a code can expire between two
 * attempts. The database computes the discount, so the number shown here is the
 * same number place_order() will use (rule 9.1).
 */
export function useValidateCoupon() {
  return useMutation({
    mutationFn: async (input: {
      storeId: string;
      code: string;
      subtotalPaise: number;
    }): Promise<CouponValidationResult> => {
      const { data, error } = await supabase.rpc('validate_coupon', {
        p_store_id: input.storeId,
        p_code: input.code,
        p_subtotal_paise: input.subtotalPaise,
      });
      if (error) throw error;
      if (!data || typeof data !== 'object') throw new Error('bad-validate-coupon-response');
      return data;
    },
  });
}

/**
 * The codes on offer right now, for the Home rail. Safe signed out: it exposes
 * only the marketing wording and the SHAPE of the limits (is there a cap, how
 * many), never how many uses have already happened. A rail that hides its own
 * scope makes the customer discover the refusal at checkout.
 */
export function useActiveOffers(storeId: string | null) {
  return useQuery<ActiveOffer[]>({
    queryKey: offerKeys.list(storeId ?? 'none'),
    enabled: Boolean(storeId),
    queryFn: async () => {
      const { data, error } = await supabase.rpc('active_offers', {
        p_store_id: storeId as string,
      });
      if (error) throw error;
      return (data ?? []) as ActiveOffer[];
    },
  });
}