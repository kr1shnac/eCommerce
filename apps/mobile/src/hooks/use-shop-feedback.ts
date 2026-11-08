import { useQuery } from '@tanstack/react-query';

import { supabase } from '@/lib/supabase';
import type { FeedbackReasonCount, FeedbackTotals } from '@/types/database';

/**
 * The shop's own answers: how many bags arrived right, and which of the six
 * complaint reasons occurred.
 *
 * WHY THIS IS AN RPC AND NOT A SUM OVER WHAT THE BOARD ALREADY FETCHED
 * ------------------------------------------------------------------
 * The same trap as `use-shop-totals.ts`, one level subtler. The board fetches at
 * most 100 orders and never fetches `order_feedback` at all — a customer's
 * answer is written after the board has stopped caring, so summing what is on
 * screen would report zero forever, with total confidence. The counts therefore
 * come from `shop_feedback_totals()` and `shop_feedback_reasons()`
 * (migration 20261108000001), which aggregate in Postgres and refuse anyone who
 * is not staff.
 *
 * WHY THERE IS NO RATING ANYWHERE
 * -------------------------------
 * `order_feedback` is one answer per delivered order, and for a shop doing a
 * handful of deliveries a day that is a handful of data points. An average over
 * it would look like information and act like noise. What these functions return
 * is counts: two numbers that add up, and the reasons that actually happened.
 * A reason that did not occur returns no row at all, which is what lets the
 * screen say "nothing yet" rather than "0".
 *
 * See migration 20261108000001 and test 29.
 */

export const feedbackKeys = {
  totals: ['shop', 'feedback', 'totals'] as const,
  reasons: ['shop', 'feedback', 'reasons'] as const,
};

/**
 * The two counts over the database's own 30-day window.
 *
 * Returns `null` — not a row of zeroes — when the caller is not staff: the
 * function uses a HAVING for exactly this reason, and `null` here is what makes
 * the owner's screen render "no answers yet" rather than "zero complaints".
 */
export function useShopFeedbackTotals() {
  return useQuery<FeedbackTotals | null>({
    queryKey: feedbackKeys.totals,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('shop_feedback_totals');
      if (error) throw error;
      const rows = (data ?? []) as FeedbackTotals[];
      return rows[0] ?? null;
    },
    refetchInterval: 120_000,
    staleTime: 60_000,
  });
}

/** The reasons that actually occurred, most frequent first. */
export function useShopFeedbackReasons() {
  return useQuery<FeedbackReasonCount[]>({
    queryKey: feedbackKeys.reasons,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('shop_feedback_reasons');
      if (error) throw error;
      return (data ?? []) as FeedbackReasonCount[];
    },
    refetchInterval: 120_000,
    staleTime: 60_000,
  });
}
