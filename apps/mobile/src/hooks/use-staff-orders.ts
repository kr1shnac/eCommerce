import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/store/auth-store';
import type { FailureReason, OrderStatus } from '@/types/database';
import type { OrderWithItems } from '@/hooks/use-orders';

/**
 * Order reads and writes for the two staff faces (rider and owner).
 *
 * The customer hooks live in `use-orders.ts`; these are separate because they
 * ask different questions ("what is waiting?", "what is mine?") and because a
 * rider must never accidentally reuse a customer mutation.
 *
 * Every write here is a plain `update` through Postgres RLS. That is correct
 * because:
 *   * only admin/delivery can reach these screens at all (role gate), and
 *   * `orders_guard_update` (migration 20261013000001) is what actually decides
 *     who may claim, advance or reassign — the app cannot talk its way past it.
 *
 * All order queries share the `['orders', ...]` prefix, so one invalidation
 * refreshes the customer list, the rider lists and the owner board together.
 */

const STAFF_SELECT = '*, order_items(*)';

export const staffOrderKeys = {
  waiting: ['orders', 'waiting'] as const,
  mine: (userId: string | null) => ['orders', 'mine', userId ?? 'none'] as const,
  delivered: (userId: string | null) => ['orders', 'delivered', userId ?? 'none'] as const,
  board: ['orders', 'board'] as const,
};

function invalidateOrders(queryClient: ReturnType<typeof useQueryClient>) {
  void queryClient.invalidateQueries({ queryKey: ['orders'] });
}

/**
 * The pool: placed, unclaimed orders, oldest first, because the oldest customer
 * has waited longest.
 *
 * `refetchInterval` is a safety net, not the mechanism. Realtime (Phase 3) pushes
 * a change the instant an order lands; but a websocket can die silently on a
 * patchy rural connection, so a slow poll still recovers the list on its own.
 * 60s is a backstop — the count a rider sees is live.
 */
export function useWaitingOrders() {
  return useQuery<OrderWithItems[]>({
    queryKey: staffOrderKeys.waiting,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('orders')
        .select(STAFF_SELECT)
        .is('assigned_to', null)
        .in('status', ['placed', 'confirmed'])
        .order('placed_at', { ascending: true })
        .limit(50);
      if (error) throw error;
      return (data ?? []) as OrderWithItems[];
    },
    refetchInterval: 60_000,
  });
}

/** Orders this rider has claimed and not yet delivered. */
export function useMyDeliveries() {
  const userId = useAuthStore((state) => state.user?.id ?? null);

  return useQuery<OrderWithItems[]>({
    queryKey: staffOrderKeys.mine(userId),
    enabled: Boolean(userId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('orders')
        .select(STAFF_SELECT)
        .eq('assigned_to', userId as string)
        .in('status', ['placed', 'confirmed', 'packing', 'out_for_delivery'])
        .order('placed_at', { ascending: true })
        .limit(50);
      if (error) throw error;
      return (data ?? []) as OrderWithItems[];
    },
    refetchInterval: 60_000,
  });
}

/** Delivered orders for this rider, newest first. The screen counts today's. */
export function useDeliveredOrders() {
  const userId = useAuthStore((state) => state.user?.id ?? null);

  return useQuery<OrderWithItems[]>({
    queryKey: staffOrderKeys.delivered(userId),
    enabled: Boolean(userId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('orders')
        .select(STAFF_SELECT)
        .eq('assigned_to', userId as string)
        .eq('status', 'delivered')
        .order('delivered_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []) as OrderWithItems[];
    },
  });
}

/** Every live order, for the owner's board. Newest first. */
export function useAdminOrders() {
  return useQuery<OrderWithItems[]>({
    queryKey: staffOrderKeys.board,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('orders')
        .select(STAFF_SELECT)
        .neq('status', 'cancelled')
        .order('placed_at', { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data ?? []) as OrderWithItems[];
    },
    refetchInterval: 60_000,
  });
}

/**
 * Claim an unassigned order. The `assigned_to is null` filter is not just an
 * optimisation: it makes a lost race (two riders tapping Accept at once) update
 * zero rows instead of stealing an order from the rider who got there first.
 */
export function useClaimOrder() {
  const queryClient = useQueryClient();
  const userId = useAuthStore((state) => state.user?.id ?? null);

  return useMutation({
    mutationFn: async (orderId: string) => {
      if (!userId) throw new Error('not-signed-in');
      const { error } = await supabase
        .from('orders')
        .update({ assigned_to: userId, assigned_at: new Date().toISOString() })
        .eq('id', orderId)
        .is('assigned_to', null);
      if (error) throw error;
    },
    onSuccess: () => invalidateOrders(queryClient),
  });
}

/** placed -> confirmed -> packing -> out_for_delivery -> delivered. */
export const NEXT_STATUS: Record<OrderStatus, OrderStatus | null> = {
  placed: 'confirmed',
  confirmed: 'packing',
  packing: 'out_for_delivery',
  out_for_delivery: 'delivered',
  delivered: null,
  cancelled: null,
  // The honest end states are reached through `useFailOrder`, not this ladder.
  failed: null,
  returned: null,
};

/** The two statuses a rider closes an order with when it did not work out. */
export const FAILABLE_FROM: OrderStatus[] = ['out_for_delivery'];
export const RETURNABLE_FROM: OrderStatus[] = ['failed', 'out_for_delivery'];

/** Move an order one step forward. Refused by the database if it is not yours. */
export function useAdvanceOrder() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: { orderId: string; from: OrderStatus }) => {
      const to = NEXT_STATUS[input.from];
      if (!to) throw new Error('nothing-to-advance');

      const patch: { status: OrderStatus; delivered_at?: string } = { status: to };
      if (to === 'delivered') patch.delivered_at = new Date().toISOString();

      const { error } = await supabase.from('orders').update(patch).eq('id', input.orderId);
      if (error) throw error;
    },
    onSuccess: () => invalidateOrders(queryClient),
  });
}

/** The rider took the bag from the counter: `picked_up_at`, once, and never cleared. */
export function usePickUpOrder() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (orderId: string) => {
      const { error } = await supabase
        .from('orders')
        .update({ picked_up_at: new Date().toISOString() })
        .eq('id', orderId);
      if (error) throw error;
    },
    onSuccess: () => invalidateOrders(queryClient),
  });
}

/**
 * Assign, reassign, or unassign a rider. Admin-only: RLS lets only staff update
 * orders, and `orders_guard_update` gives the rider branch no way to reach here
 * (a rider changing `assigned_to` is refused unless they are claiming).
 */
export function useAssignRider() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: { orderId: string; riderId: string | null }) => {
      const patch = input.riderId
        ? { assigned_to: input.riderId, assigned_at: new Date().toISOString() }
        : { assigned_to: null, assigned_at: null };

      const { error } = await supabase.from('orders').update(patch).eq('id', input.orderId);
      if (error) throw error;
    },
    onSuccess: () => invalidateOrders(queryClient),
  });
}

/**
 * Close an order honestly: the delivery could not be made, or the bag came back.
 *
 * This is not a cancel. `cancelled` means nobody ever left the shop; `failed`
 * means a rider stood at a door and it did not work. The database requires a
 * reason (migration 20261021000001), and the guard refuses a failure from any
 * state that does not mean the bag is with the rider — so a rider cannot use
 * this to skip the delivery.
 */
export function useFailOrder() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: {
      orderId: string;
      reason: FailureReason;
      note?: string | null;
      /**
       * `failed` = the attempt failed now; `returned` = the bag is back at the
       * shop. Both are terminal, so the rider picks the true one rather than
       * stepping through two taps.
       */
      status?: 'failed' | 'returned';
    }) => {
      const patch: {
        status: 'failed' | 'returned';
        failure_reason: FailureReason;
        failure_note: string | null;
      } = {
        status: input.status ?? 'failed',
        failure_reason: input.reason,
        failure_note: input.note?.trim() ? input.note.trim() : null,
      };

      const { error } = await supabase.from('orders').update(patch).eq('id', input.orderId);
      if (error) throw error;
    },
    onSuccess: () => invalidateOrders(queryClient),
  });
}
