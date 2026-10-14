import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import { selectCartCount, useCartStore } from '@/store/cart-store';
import { useLanguageStore } from '@/store/language-store';
import { localizedName } from '@/lib/localized';
import { supabase } from '@/lib/supabase';
import type { Product, UnavailableItem } from '@/types/database';

/**
 * The cart, joined with what the shop is actually selling right now.
 *
 * This hook never trusts the stored quantities on their own. Every line is
 * checked against the live product row, and anything that no longer works
 * (sold out, taken off the shelf, deleted) comes back as an `adjustment` the
 * customer has to be told about. Nothing is ever quietly dropped: the caller
 * shows the message and asks before it changes the basket.
 */

export type CartLineView = {
  productId: string;
  product: Product | null;
  quantity: number;
  lineTotalPaise: number;
  /** False when the product is gone or there is not enough of it. */
  isAvailable: boolean;
};

export type CartAdjustment = {
  productId: string;
  name: string;
  unit: string | null;
  /** What the customer asked for. */
  from: number;
  /** What we can actually do. 0 means "remove this line". */
  to: number;
  reason: 'unavailable' | 'insufficient_stock';
};

export type UseCart = {
  lines: CartLineView[];
  adjustments: CartAdjustment[];
  subtotalPaise: number;
  unitCount: number;
  lineCount: number;
  isLoading: boolean;
  isError: boolean;
  refetch: () => void;
  /** Rewrite the stored cart to match reality. Only call after telling the customer. */
  applyAdjustments: () => void;
  /** Rewrite the cart from the server's complaint, and describe what changed. */
  applyUnavailable: (items: UnavailableItem[]) => CartAdjustment[];
};

export function useCart(): UseCart {
  const items = useCartStore((state) => state.items);
  const hasHydrated = useCartStore((state) => state.hasHydrated);
  const setQuantity = useCartStore((state) => state.setQuantity);
  // The adjustment message names a product, so the language is part of the cache
  // key: switching language must re-run this memo, not keep the English name.
  const language = useLanguageStore((state) => state.language);
  // Sorted, so the query key is a stable string instead of a new array on
  // every render (which would refetch forever).
  const idsKey = useMemo(() => Object.keys(items).sort().join(','), [items]);

  const query = useQuery<Product[]>({
    queryKey: ['cart-products', idsKey],
    enabled: hasHydrated && idsKey.length > 0,
    queryFn: async () => {
      const ids = idsKey.length > 0 ? idsKey.split(',') : [];
      const { data, error } = await supabase
        .from('products')
        .select('*')
        .in('id', ids);
      if (error) throw error;
      return data ?? [];
    },
    staleTime: 15_000,
  });

  const byId = useMemo(() => {
    const map = new Map<string, Product>();
    for (const product of query.data ?? []) map.set(product.id, product);
    return map;
  }, [query.data]);

  const { lines, adjustments, subtotalPaise } = useMemo(() => {
    const nextLines: CartLineView[] = [];
    const nextAdjustments: CartAdjustment[] = [];
    let subtotal = 0;

    for (const [productId, quantity] of Object.entries(items)) {
      const product = byId.get(productId) ?? null;
      const onShelf = product ? product.stock_qty : 0;
      const isActive = product ? product.is_active : false;
      const usable = product && isActive ? Math.min(quantity, onShelf) : 0;

      nextLines.push({
        productId,
        product,
        quantity,
        lineTotalPaise: product && usable > 0 ? product.price_paise * usable : 0,
        isAvailable: usable === quantity && usable > 0,
      });

      if (usable < quantity) {
        nextAdjustments.push({
          productId,
          name: product ? localizedName(product, language) : '',
          unit: product?.unit ?? null,
          from: quantity,
          to: usable,
          reason: product && isActive ? 'insufficient_stock' : 'unavailable',
        });
      }

      // Only count what we could actually deliver.
      if (product && isActive) subtotal += product.price_paise * usable;
    }

    return { lines: nextLines, adjustments: nextAdjustments, subtotalPaise: subtotal };
  }, [items, byId, language]);

  const applyAdjustments = () => {
    for (const adjustment of adjustments) setQuantity(adjustment.productId, adjustment.to);
  };

  const applyUnavailable = (serverItems: UnavailableItem[]) => {
    const applied: CartAdjustment[] = [];
    for (const item of serverItems) {
      const from = useCartStore.getState().items[item.product_id] ?? 0;
      if (from === item.available) continue;
      setQuantity(item.product_id, item.available);
      applied.push({
        productId: item.product_id,
        name: localizedName(
          { name_en: item.name_en ?? '', name_kn: item.name_kn ?? null },
          language,
        ),
        unit: item.unit ?? null,
        from,
        to: item.available,
        reason: item.reason,
      });
    }
    return applied;
  };

  return {
    lines,
    adjustments,
    subtotalPaise,
    unitCount: useCartStore(selectCartCount),
    lineCount: Object.keys(items).length,
    isLoading: hasHydrated && idsKey.length > 0 && query.isLoading,
    isError: query.isError,
    refetch: () => void query.refetch(),
    applyAdjustments,
    applyUnavailable,
  };
}