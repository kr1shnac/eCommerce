import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { supabase } from '@/lib/supabase';
import type { PackUnit, Product, ProductSoldBy } from '@/types/database';

/**
 * The shelf, from the counter.
 *
 * Two things the owner does all day, and until now could not: change a price,
 * and say "none left". Both used to require the web panel, which is a desk tool;
 * the owner runs the shop from a phone. What runs out changes hourly in a grocery
 * shop, so the shelf drifted out of date and the shop sold what it did not have —
 * every one of those becomes a failed delivery.
 *
 * The write goes through `update_product_from_shop()` rather than a plain
 * `.update()`. That matters more than it looks:
 *
 *   * a plain `.update()` by someone who is not the shop touches ZERO rows and
 *     reports NO error (RLS filters the row out). A screen trusting it would show
 *     "Saved" while nothing was saved — the exact lie rule 9.4 is about. The RPC
 *     raises instead;
 *   * the RPC returns the row as the database now holds it, so the screen shows
 *     the stored number, not the number it hoped it wrote (rule 9.1).
 *
 * The prices are paise integers throughout (rule 1). Nothing here converts to
 * rupees; `formatPaise` does that at the very edge of the UI.
 */

export const shelfKeys = {
  products: (storeId: string | null) => ['shelf', storeId ?? 'none'] as const,
};

/**
 * Every product on the shelf, active or not — the owner is looking at their own
 * shelf, so a product taken off it must still be visible here or they could never
 * put it back. Reading an inactive row needs an admin (RLS); a non-admin's call
 * comes back empty rather than erroring.
 */
export function useShelfProducts(storeId: string | null) {
  return useQuery<Product[]>({
    queryKey: shelfKeys.products(storeId),
    enabled: Boolean(storeId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('products')
        .select('*')
        .eq('store_id', storeId as string)
        .order('sort_order', { ascending: true });
      if (error) throw error;
      return (data ?? []) as Product[];
    },
  });
}

/** The four counter fields, plus emoji and the pack. A null means "leave this one alone". */
export type ShelfEdit = {
  productId: string;
  /** Selling price in PAISE. */
  pricePaise?: number;
  /** Printed "was" price in PAISE, or null to clear it. */
  mrpPaise?: number | null;
  stockQty?: number;
  isActive?: boolean;
  emoji?: string | null;
  /**
   * The pack (register M4). Changing what a pack IS is not an ordinary shelf
   * save: the product guard freezes `sold_by` / `pack_size` / `pack_unit`, so a
   * mis-tap cannot turn a 1 kg bag into a 5 kg bag at the 1 kg price. This field
   * is only ever sent by an explicit "this pack is wrong" action, never by the
   * ordinary save button.
   */
  pack?: { soldBy: ProductSoldBy; size: number | null; unit: PackUnit | null };
};

/**
 * One tap, one call. The screen must disable its control while this is in
 * flight — the RPC is idempotent for a *value* ("set price to 5200" twice is the
 * same shelf), but a double tap on a stepper would still move stock twice.
 */
export function useUpdateShelf() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (edit: ShelfEdit): Promise<Product> => {
      // Sending `undefined` for a field means "not mentioned" to the function's
      // `coalesce`, whereas an explicit `null` is passed through. PostgREST omits
      // undefined keys, which is exactly what we want.
      const { data, error } = await supabase.rpc('update_product_from_shop', {
        p_product_id: edit.productId,
        p_price_paise: edit.pricePaise,
        p_mrp_paise: edit.mrpPaise === undefined ? undefined : edit.mrpPaise,
        p_stock_qty: edit.stockQty,
        p_is_active: edit.isActive,
        p_emoji: edit.emoji === undefined ? undefined : edit.emoji,
        // The pack is only sent when the owner explicitly says "this pack is
        // wrong". The ordinary save omits it, so the guard's identity freeze can
        // never be tripped by a slip of the thumb on the price field.
        p_sold_by: edit.pack?.soldBy,
        p_pack_size: edit.pack?.size,
        p_pack_unit: edit.pack?.unit,
      });
      if (error) throw error;
      return data as unknown as Product;
    },
    onSuccess: async (product) => {
      // The owner's own list, and the customer's shop, are the same rows.
      await queryClient.invalidateQueries({ queryKey: ['shelf'] });
      await queryClient.invalidateQueries({ queryKey: ['products'] });
      await queryClient.invalidateQueries({ queryKey: ['product', product.id] });
      // The cart reads prices and stock from its own key, so a price the owner
      // just changed mid-shop-window must reach a basket already holding it.
      await queryClient.invalidateQueries({ queryKey: ['cart-products'] });
    },
  });
}

/**
 * Everything the owner types to create a product (register M6).
 *
 * The shapes are PAISE and a pack, never rupees and never weight-as-a-fraction —
 * the screen turns what the owner typed into these before calling, exactly once.
 */
export type NewProduct = {
  nameEn: string;
  nameKn: string;
  /** Selling price in PAISE. */
  pricePaise: number;
  categoryId: string | null;
  soldBy: ProductSoldBy;
  /** The size of ONE pack, in `packUnit`. Null for a plain counted product. */
  packSize: number | null;
  packUnit: PackUnit | null;
  /** Printed "was" price in PAISE, or null when the shop does not print one. */
  mrpPaise: number | null;
  stockQty: number;
  emoji: string | null;
};

/**
 * Add a product to the shelf.
 *
 * Goes through `create_product_from_shop()` rather than a plain `.insert()`, for
 * the same reason the shelf save does: the RPC RAISES when the caller is not the
 * owner, where a plain insert can match zero rows and report no error. It also
 * requires a real Kannada name — the one thing this whole item is about — and
 * derives the customer-facing pack text from the structured pack, so the two can
 * never disagree.
 *
 * `storeId` is deliberately NOT sent: the function finds the active shop itself,
 * so a modified client cannot create a product in a shop it does not own.
 */
export function useCreateProduct() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: NewProduct): Promise<Product> => {
      const { data, error } = await supabase.rpc('create_product_from_shop', {
        p_name_en: input.nameEn,
        p_name_kn: input.nameKn,
        p_price_paise: input.pricePaise,
        p_category_id: input.categoryId,
        p_sold_by: input.soldBy,
        p_pack_size: input.packSize,
        p_pack_unit: input.packUnit,
        p_mrp_paise: input.mrpPaise,
        p_stock_qty: input.stockQty,
        p_emoji: input.emoji,
      });
      if (error) throw error;
      return data as unknown as Product;
    },
    onSuccess: async (product) => {
      await queryClient.invalidateQueries({ queryKey: ['shelf'] });
      await queryClient.invalidateQueries({ queryKey: ['products'] });
      await queryClient.invalidateQueries({ queryKey: ['product', product.id] });
      await queryClient.invalidateQueries({ queryKey: ['cart-products'] });
      // The category counts on Home change when a product is added to one.
      await queryClient.invalidateQueries({ queryKey: ['categories'] });
    },
  });
}
