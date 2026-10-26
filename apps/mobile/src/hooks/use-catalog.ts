import { useQuery } from '@tanstack/react-query';

import { supabase } from '@/lib/supabase';
import type { Category, Product } from '@/types/database';

export const catalogKeys = {
  categories: ['categories'] as const,
  products: (categoryId: string | null) => ['products', categoryId ?? 'all'] as const,
  product: (id: string) => ['product', id] as const,
};

/**
 * How long a shelf answer is trusted without asking again (register PERF-3).
 *
 * Five minutes, up from one. The catalogue is the same list for every customer
 * and the shop changes a price a few times a day, not a few times a minute — so
 * re-fetching it on every tab switch was pure waste on a rural connection, and
 * the customer paid for it in seconds.
 *
 * **This can never make a customer pay the wrong price.** `place_order()`
 * recomputes every line from `products` at write time (AGENTS.md §9.1), so a
 * stale shelf is only ever a *displayed* number. If the owner changed a price
 * inside the window, the customer sees the new one at checkout, which is where
 * they are looking anyway; pull-to-refresh is one gesture if they want it now.
 *
 * Order data deliberately does NOT use this: it changes because of what a
 * customer themselves just did, and Realtime invalidates it regardless.
 */
const SHELF_STALE_MS = 5 * 60_000;

export function useCategories() {
  return useQuery<Category[]>({
    queryKey: catalogKeys.categories,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('categories')
        .select('*')
        .eq('is_active', true)
        .order('sort_order', { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
    staleTime: SHELF_STALE_MS,
  });
}

export function useProducts(categoryId: string | null) {
  return useQuery<Product[]>({
    queryKey: catalogKeys.products(categoryId),
    queryFn: async () => {
      let query = supabase.from('products').select('*').eq('is_active', true);
      if (categoryId) query = query.eq('category_id', categoryId);
      const { data, error } = await query.order('sort_order', { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
    staleTime: SHELF_STALE_MS,
  });
}

/**
 * One product, for its own page. Shares nothing with the grid query on purpose:
 * opening a detail screen must work even if the Home query was never run (a deep
 * link, or a cold start straight onto a saved item). `null` means the shop no
 * longer sells it, which the screen shows as a friendly "gone" state.
 */
export function useProduct(id: string | null) {
  return useQuery<Product | null>({
    queryKey: catalogKeys.product(id ?? 'none'),
    enabled: Boolean(id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('products')
        .select('*')
        .eq('id', id as string)
        .maybeSingle();
      if (error) throw error;
      return data ?? null;
    },
    staleTime: SHELF_STALE_MS,
  });
}
