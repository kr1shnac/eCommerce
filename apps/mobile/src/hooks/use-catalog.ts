import { useQuery } from '@tanstack/react-query';

import { supabase } from '@/lib/supabase';
import type { Category, Product } from '@/types/database';

export const catalogKeys = {
  categories: ['categories'] as const,
  products: (categoryId: string | null) => ['products', categoryId ?? 'all'] as const,
  product: (id: string) => ['product', id] as const,
};

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
    staleTime: 60_000,
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
    staleTime: 60_000,
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
    staleTime: 60_000,
  });
}
