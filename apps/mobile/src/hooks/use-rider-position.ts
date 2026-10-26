import { useQuery } from '@tanstack/react-query';

import { supabase } from '@/lib/supabase';
import type { OrderRiderPosition } from '@/types/database';

export const riderPositionKeys = {
  forOrder: (orderId: string | null) => [
    'rider-position',
    orderId ?? 'none',
  ] as const,
};

/**
 * The assigned rider's position for one order, polled every 30 seconds.
 *
 * WHY A POLL, NOT REALTIME
 * ------------------------
 * `rider_positions` has no read policy at all (migration 20261026000001): the
 * only read path is the `order_rider_position` view, and Supabase Realtime
 * enforces RLS on its change stream. A customer subscribing to
 * `rider_positions` would receive nothing, so Realtime cannot push a new fix
 * here. A 30 s poll can — and because the screen shows the position's age
 * ("updated 20 s ago"), a poll that is honest about its staleness is better
 * than a websocket that pretends to be live. Realtime is the upgrade; the poll
 * is the baseline (SCALE-AND-TRACKING.md §5.2 and §6.3).
 *
 * The view itself returns no row at all when the fix is stale (>10 min), too
 * imprecise (>150 m), or the delivery has ended — so this query either returns
 * one showable position or nothing, and the screen never has to decide whether
 * to distrust a dot.
 */
export function useRiderPosition(orderId: string | null) {
  return useQuery<OrderRiderPosition | null>({
    queryKey: riderPositionKeys.forOrder(orderId),
    enabled: Boolean(orderId),
    refetchInterval: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('order_rider_position')
        .select('*')
        .eq('order_id', orderId as string)
        .maybeSingle();
      if (error) throw error;
      return (data as OrderRiderPosition | null) ?? null;
    },
  });
}
