import { useQuery } from '@tanstack/react-query';

import { supabase } from '@/lib/supabase';
import type { Category, Product } from '@/types/database';

export const catalogKeys = {
  categories: ['categories'] as const,
  products: (categoryId: string | null) => ['products', categoryId ?? 'all'] as const,
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