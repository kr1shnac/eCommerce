import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { supabase } from '@/lib/supabase';
import type { Coupon, CouponKind } from '@/types/database';

/**
 * The owner's coupon codes.
 *
 * RLS ("admins manage coupons", migration 20261014000004) hides the whole table
 * from customers: a customer reaches a code only through `validate_coupon()` or
 * `place_order()`. So this screen only ever runs for the owner — and, like every
 * other screen, it never works out a discount itself. The database does that
 * (rule 9.1); the app only writes the code and its rules.
 */

export const couponKeys = {
  list: (storeId: string | null) => ['coupons', storeId ?? 'none'] as const,
};

/**
 * What the form collects. Columns the database owns — `id`, the timestamps and
 * `used_count` — are deliberately absent, so the app can never write them.
 *
 * `value` is a percent (1..100) for a `percent` code, or paise for a `flat` one.
 * The form only accepts whole rupees, which it multiplies by 100 before it gets
 * here; money never passes through a float (`lib/money.ts`, rule 1).
 */
export type CouponDraft = {
  storeId: string;
  code: string;
  kind: CouponKind;
  value: number;
  maxDiscountPaise: number;
  minOrderPaise: number;
  isActive: boolean;
  /** NULL means unlimited uses. */
  usageLimit: number | null;
  descriptionEn: string;
  descriptionKn: string;
};

export function useCoupons(storeId: string | null) {
  return useQuery<Coupon[]>({
    queryKey: couponKeys.list(storeId),
    enabled: Boolean(storeId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('coupons')
        .select('*')
        .eq('store_id', storeId as string)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as Coupon[];
    },
  });
}

/** Postgres unique-violation, which here means "that code already exists". */
export const COUPON_DUPLICATE_CODE = '23505';

/** The column values a create or an edit writes. `store_id` is added on create. */
function toColumns(draft: Omit<CouponDraft, 'storeId'>) {
  return {
    code: draft.code.trim().toUpperCase(),
    kind: draft.kind,
    value: draft.value,
    max_discount_paise: draft.maxDiscountPaise,
    min_order_paise: draft.minOrderPaise,
    is_active: draft.isActive,
    usage_limit: draft.usageLimit,
    description_en: draft.descriptionEn.trim() || null,
    description_kn: draft.descriptionKn.trim() || null,
  };
}

/**
 * Both the coupon list and the customer-facing offers rail have to be told a code
 * changed: the rail is built from `active_offers()`, which reads the same rows.
 */
async function invalidateCoupons(queryClient: ReturnType<typeof useQueryClient>, storeId: string) {
  await queryClient.invalidateQueries({ queryKey: couponKeys.list(storeId) });
  await queryClient.invalidateQueries({ queryKey: ['offers'] });
}

export function useCreateCoupon() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (draft: CouponDraft) => {
      const { error } = await supabase
        .from('coupons')
        .insert({ store_id: draft.storeId, ...toColumns(draft) });
      if (error) throw error;
    },
    onSuccess: async (_data, draft) => invalidateCoupons(queryClient, draft.storeId),
  });
}

export function useUpdateCoupon() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: { id: string; storeId: string } & Omit<CouponDraft, 'storeId'>) => {
      const { error } = await supabase
        .from('coupons')
        .update(toColumns(input))
        .eq('id', input.id);
      if (error) throw error;
    },
    onSuccess: async (_data, input) => invalidateCoupons(queryClient, input.storeId),
  });
}

/** Flip a code on or off without opening the whole form. */
export function useSetCouponActive() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: { id: string; storeId: string; isActive: boolean }) => {
      const { error } = await supabase
        .from('coupons')
        .update({ is_active: input.isActive })
        .eq('id', input.id);
      if (error) throw error;
    },
    onSuccess: async (_data, input) => invalidateCoupons(queryClient, input.storeId),
  });
}

export function useDeleteCoupon() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: { id: string; storeId: string }) => {
      const { error } = await supabase.from('coupons').delete().eq('id', input.id);
      if (error) throw error;
    },
    onSuccess: async (_data, input) => invalidateCoupons(queryClient, input.storeId),
  });
}
