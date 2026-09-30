import { useQuery } from '@tanstack/react-query';

import { supabase } from '@/lib/supabase';
import type { RiderDayTotal, ShopDayTotals } from '@/types/database';

/**
 * The owner's day: what the shop took, and who is holding the cash.
 *
 * WHY THIS IS AN RPC AND NOT A SUM OVER `useAdminOrders()`
 *
 * The tempting shortcut is to add up what the board already fetched. That would
 * be wrong in a way that looks right. The board asks for at most 100 orders and
 * filters cancelled ones out; on a day with more orders than that, the "today"
 * figure would quietly under-report, and the owner would have no way to tell a
 * slow day from a truncated list.
 *
 * So the totals come from `shop_day_totals()` / `shop_day_by_rider()`, which
 * aggregate in Postgres over the whole day and encode the accounting rules there
 * (a failed delivery is not a sale; COD that has not been paid is money in a
 * rider's pocket, not money banked). Those functions refuse anyone who is not
 * staff, so this hook is only useful on the owner's screen — which is exactly
 * where it is used.
 *
 * See migration 20261021000002_shop_totals.sql and test 19.
 */

export const shopTotalsKeys = {
  day: (day: string | null) => ['shop', 'totals', day ?? 'today'] as const,
  riders: (day: string | null) => ['shop', 'totals', 'riders', day ?? 'today'] as const,
};

/**
 * Today's totals, or one named day (`YYYY-MM-DD`) when the owner looks back.
 * `day` null means "today in the shop's timezone", decided by the database so
 * the phone's own clock and timezone cannot shift the shop's day.
 */
export function useShopDayTotals(day: string | null = null) {
  return useQuery<ShopDayTotals>({
    queryKey: shopTotalsKeys.day(day),
    queryFn: async () => {
      const { data, error } = await supabase.rpc('shop_day_totals', {
        p_day: day,
      });
      if (error) throw error;
      if (!data) throw new Error('no-totals');
      return data as ShopDayTotals;
    },
    // The board polls every 60s; the totals move with it. Realtime order
    // changes already invalidate the `['orders', ...]` prefix, and this query
    // sits under `['shop', ...]`, so it re-reads on this interval as the
    // backstop for a dropped socket on rural 4G.
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
}

/** The per-rider breakdown for the same day: who delivered, and who holds cash. */
export function useShopDayByRider(day: string | null = null) {
  return useQuery<RiderDayTotal[]>({
    queryKey: shopTotalsKeys.riders(day),
    queryFn: async () => {
      const { data, error } = await supabase.rpc('shop_day_by_rider', {
        p_day: day,
      });
      if (error) throw error;
      return (data ?? []) as RiderDayTotal[];
    },
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
}
