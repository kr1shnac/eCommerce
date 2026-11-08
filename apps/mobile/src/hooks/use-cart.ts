import { useQuery } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';

import { mergeIntoCart, productIdsFor } from '@/lib/saved-later';
import { selectCartCount, useCartStore } from '@/store/cart-store';
import { useLanguageStore } from '@/store/language-store';
import { localizedName } from '@/lib/localized';
import { supabase } from '@/lib/supabase';
import { useSavedStore } from '@/store/saved-store';
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
  /**
   * How much less than MRP this basket costs, in paise. Computed from the
   * `mrp_paise` printed on each available product, never from a client field,
   * and never negative (a product with no MRP, or priced at/above it, adds 0).
   * Coupon discounts are a checkout concept and are not included here.
   */
  mrpSavingsPaise: number;
  unitCount: number;
  lineCount: number;
  isLoading: boolean;
  isError: boolean;
  refetch: () => void;
  /** Rewrite the stored cart to match reality. Only call after telling the customer. */
  applyAdjustments: () => void;
  /** Rewrite the cart from the server's complaint, and describe what changed. */
  applyUnavailable: (items: UnavailableItem[]) => CartAdjustment[];
  /** Set one line aside: it leaves the bag and appears on the saved shelf. */
  saveForLater: (productId: string) => void;
  /** Put one saved line back in the bag, and take it off the shelf. */
  moveToCart: (productId: string) => void;
  /** Put the whole shelf back in the bag, in one tap. */
  moveAllToCart: () => void;
  /** Take one saved line off the shelf for good. */
  forgetSaved: (productId: string) => void;
  /** The saved shelf, joined with live product rows the same way the bag is. */
  saved: SavedLineView[];
};

/** A line on the saved shelf: the product if it still exists, and how many. */
export type SavedLineView = {
  productId: string;
  product: Product | null;
  quantity: number;
};

export function useCart(): UseCart {
  const items = useCartStore((state) => state.items);
  const hasHydrated = useCartStore((state) => state.hasHydrated);
  const setQuantity = useCartStore((state) => state.setQuantity);
  const replaceAll = useCartStore((state) => state.replaceAll);
  const savedItems = useSavedStore((state) => state.items);
  const saveToShelf = useSavedStore((state) => state.save);
  const forgetFromShelf = useSavedStore((state) => state.forget);
  // The adjustment message names a product, so the language is part of the cache
  // key: switching language must re-run this memo, not keep the English name.
  const language = useLanguageStore((state) => state.language);
  // Sorted, so the query key is a stable string instead of a new array on
  // every render (which would refetch forever). The bag and the saved shelf
  // share ONE query: on a patchy connection the second round trip is the
  // difference between a screen that appears and one that does not.
  const idsKey = useMemo(() => productIdsFor(items, savedItems).join(','), [items, savedItems]);

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

  const { lines, adjustments, subtotalPaise, mrpSavingsPaise } = useMemo(() => {
    const nextLines: CartLineView[] = [];
    const nextAdjustments: CartAdjustment[] = [];
    let subtotal = 0;
    let savings = 0;

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
      if (product && isActive) {
        subtotal += product.price_paise * usable;

        // The saving is the gap between the printed MRP and the shelf price, on
        // the same deliverable units the subtotal uses. Integer paise only; a
        // product without an MRP, or priced at/above it, contributes nothing.
        const mrp = product.mrp_paise;
        if (mrp !== null && mrp > product.price_paise) {
          savings += (mrp - product.price_paise) * usable;
        }
      }
    }

    return {
      lines: nextLines,
      adjustments: nextAdjustments,
      subtotalPaise: subtotal,
      mrpSavingsPaise: savings,
    };
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

  /**
   * Set a line aside: the quantity the customer wanted is copied onto the shelf
   * and the line leaves the bag, so an item is never in both lists.
   *
   * The copy is the point. "Save for later" on 2 onions and then "put back"
   * must restore 2 onions — the alternative is a shelf that remembers the
   * product but forgets the shopping, which is a list the customer has to
   * rebuild by hand.
   */
  const saveForLater = useCallback(
    (productId: string) => {
      const quantity = useCartStore.getState().items[productId];
      if (!quantity || quantity < 1) return;
      saveToShelf(productId, quantity);
      setQuantity(productId, 0);
    },
    [saveToShelf, setQuantity],
  );

  /**
   * Put one saved line back in the bag: added to whatever is already there,
   * never written over it, and taken off the shelf in the same breath so the
   * two lists cannot overlap.
   */
  const moveToCart = useCallback(
    (productId: string) => {
      const quantity = useSavedStore.getState().items[productId];
      if (!quantity || quantity < 1) return;
      setQuantity(productId, (useCartStore.getState().items[productId] ?? 0) + quantity);
      forgetFromShelf(productId);
    },
    [forgetFromShelf, setQuantity],
  );

  const forgetSaved = useCallback(
    (productId: string) => forgetFromShelf(productId),
    [forgetFromShelf],
  );

  /**
   * Everything back in the bag, in one tap. `mergeIntoCart` is the pure half:
   * it tops up what is already in the bag, respects the line cap by keeping
   * the overflow on the shelf rather than losing it, and refuses a corrupted
   * quantity.
   */
  const moveAllToCart = useCallback(() => {
    const shelf = useSavedStore.getState().items;
    if (Object.keys(shelf).length === 0) return;
    replaceAll(mergeIntoCart(shelf, useCartStore.getState().items));
    useSavedStore.getState().clear();
  }, [replaceAll]);

  // The saved shelf, joined with the SAME live product rows as the bag: a line
  // that has sold out since is reported as unavailable here too, never kept as
  // if it could still be bought.
  const saved = useMemo(() => {
    const next: SavedLineView[] = [];
    for (const [productId, quantity] of Object.entries(savedItems)) {
      next.push({ productId, product: byId.get(productId) ?? null, quantity });
    }
    return next;
  }, [savedItems, byId]);

  return {
    lines,
    adjustments,
    subtotalPaise,
    mrpSavingsPaise,
    unitCount: useCartStore(selectCartCount),
    lineCount: Object.keys(items).length,
    isLoading: hasHydrated && idsKey.length > 0 && query.isLoading,
    isError: query.isError,
    refetch: () => void query.refetch(),
    applyAdjustments,
    applyUnavailable,
    saveForLater,
    moveToCart,
    moveAllToCart,
    forgetSaved,
    saved,
  };
}