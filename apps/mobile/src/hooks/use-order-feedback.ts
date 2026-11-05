import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/store/auth-store';
import type { FeedbackReason, OrderFeedback } from '@/types/database';

/**
 * The customer's answer to "was everything right?" (migration 20261106000001).
 *
 * Reading is one indexed row keyed by the order, so it costs nothing until the
 * order is delivered and the customer owns it. Writing is a plain INSERT: the
 * table makes a second one impossible (`order_id` is the primary key), and RLS
 * refuses an answer for somebody else's order or one that has not arrived. The
 * app never decides any of that — it only asks, and shows the answer.
 */

export const feedbackKeys = {
  forOrder: (orderId: string) => ['order-feedback', orderId] as const,
};

export function useOrderFeedback(orderId: string | null) {
  const session = useAuthStore((state) => state.session);
  const enabled = Boolean(orderId && session);

  return useQuery<OrderFeedback | null>({
    queryKey: feedbackKeys.forOrder(orderId ?? ''),
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('order_feedback')
        .select('order_id, user_id, was_ok, reason, created_at')
        .eq('order_id', orderId!)
        .maybeSingle();
      if (error) throw error;
      return (data as OrderFeedback | null) ?? null;
    },
    // An answer never changes once written, so there is nothing to refetch for.
    staleTime: Infinity,
  });
}

type SubmitInput = {
  orderId: string;
  wasOk: boolean;
  reason: FeedbackReason | null;
};

export function useSubmitOrderFeedback() {
  const queryClient = useQueryClient();
  const session = useAuthStore((state) => state.session);

  return useMutation({
    mutationFn: async ({ orderId, wasOk, reason }: SubmitInput) => {
      const userId = session?.user.id;
      if (!userId) throw new Error('not_logged_in');

      const { data, error } = await supabase
        .from('order_feedback')
        .insert({ order_id: orderId, user_id: userId, was_ok: wasOk, reason })
        .select('order_id, user_id, was_ok, reason, created_at')
        .single();

      // 23505 means this order was already answered — e.g. a retried request
      // that did land the first time. That is the desired end state, not an
      // error to show the customer: the refetch below reveals the answer.
      if (error && error.code !== '23505') throw error;
      return (data as OrderFeedback | null) ?? null;
    },
    onSuccess: (row, { orderId }) => {
      if (row) queryClient.setQueryData(feedbackKeys.forOrder(orderId), row);
      // Also covers the 23505 path, where `row` is null but the table has one.
      void queryClient.invalidateQueries({ queryKey: feedbackKeys.forOrder(orderId) });
    },
  });
}
