import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useCartStore } from '@/store/cart-store';
import { supabase } from '@/lib/supabase';
import type {
  Address,
  CancelOrderResult,
  Order,
  OrderItem,
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

  constructor(result: Extract<PlaceOrderResult, { ok: false }>) {
    super(result.error);
    this.name = 'PlaceOrderRejected';
    this.code = result.error;
    this.items = result.items ?? [];
    this.minOrderPaise = result.min_order_value_paise ?? null;
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
};

const ORDER_SELECT = '*, order_items(*)';

// -----------------------------------------------------------------------------
// Addresses
// -----------------------------------------------------------------------------

export const addressKeys = {
  list: ['addresses'] as const,
};

export function useAddresses() {
  return useQuery<Address[]>({
    queryKey: addressKeys.list,
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
};

/**
 * Save an address, then make it the first one if it is the customer's only one.
 * Kept idempotent-ish: an error leaves the list untouched rather than half-saved.
 */
export function useAddAddress() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (address: NewAddress) => {
      const { data, error } = await (supabase
        .from('addresses') as any)
        .insert(address as any)
        .select('*')
        .single();
      if (error) throw error;
      return data as any;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: addressKeys.list });
    },
  });
}

// -----------------------------------------------------------------------------
// Orders
// -----------------------------------------------------------------------------

export function useOrders() {
  return useQuery<OrderWithItems[]>({
    queryKey: orderKeys.list,
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
    }): Promise<Extract<PlaceOrderResult, { ok: true }>> => {
      const items = Object.entries(useCartStore.getState().items).map(([product_id, quantity]) => ({
        product_id,
        quantity,
      }));

      const { data, error } = await (supabase.rpc as any)('place_order', {
        p_items: items,
        p_store_id: input.storeId,
        p_address_id: input.addressId,
        p_idempotency_key: input.idempotencyKey,
        p_note: input.note,
      });

      if (error) throw error;
      // The function always returns jsonb; guard anyway rather than crash.
      if (!data || typeof data !== 'object') throw new Error('bad-place-order-response');
      if (!data.ok) throw new PlaceOrderRejected(data);
      return data as any;
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
      const { data, error } = await (supabase.rpc as any)('cancel_order', { p_order_id: orderId });
      if (error) throw error;
      if (!data || typeof data !== 'object') throw new Error('bad-cancel-order-response');
      if (!(data as any).ok) throw new CancelOrderRejected(data as any);
      return data as Address;
    },
    onSuccess: async (_result, orderId) => {
      await queryClient.invalidateQueries({ queryKey: orderKeys.list });
      await queryClient.invalidateQueries({ queryKey: orderKeys.detail(orderId) });
      // Cancelling puts stock back on the shelf, so the catalogue is stale too.
      await queryClient.invalidateQueries({ queryKey: ['cart-products'] });
    },
  });
}