import { useQuery } from '@tanstack/react-query';

import { packInBase } from '@/lib/pack';
import { supabase } from '@/lib/supabase';
import type { PackUnit, Product, ProductSoldBy } from '@/types/database';

/**
 * The other pack sizes of the same thing (register M4).
 *
 * THE QUESTION THIS ANSWERS. A customer looking at a 500 g packet of tomato wants
 * to know whether the shop also has a kilo — and in a town where the weekly shop
 * is a kilo of onion and the daily one is a packet of milk, that is the most
 * ordinary question in the shop. Before M4 the app could not ask it, because a
 * pack was free text ('500 g', '1 kg') that nothing could compare.
 *
 * HOW THE MATCHING WORKS, AND WHY IT IS DELIBERATELY CONSERVATIVE. Two products are
 * treated as the same thing in different sizes when:
 *   * both are `measure` products in the **same store and same category**, and
 *   * their **Kannada names match exactly**.
 *
 * The name is the identity here, not a guess. Kannada names in this shop are the
 * shop's own words for a thing — `ಟೊಮೆಟೊ` is tomato and nothing else — and
 * `seed.sql` is the only place they are written. Matching on the English name would
 * break the moment the shop renames a product in English only, and matching on a
 * fuzzy string would eventually offer a customer "also in 1 kg" for something that
 * is not the same product at all, which is worse than offering nothing.
 *
 * A false negative is the acceptable failure: the customer sees a normal product
 * page with no chips, which is exactly what they saw before M4. A false positive
 * sells the wrong thing.
 *
 * The alternatives are **display only**. The customer still taps through to the
 * other product's own page and adds it there, so its own price, stock and guard
 * rules apply — this view never lets a customer buy one product at another's price.
 */
export const packOptionKeys = {
  forProduct: (productId: string) => ['pack-options', productId] as const,
};

type PackOptionRow = Pick<
  Product,
  | 'id'
  | 'name_en'
  | 'name_kn'
  | 'price_paise'
  | 'pack_size'
  | 'pack_unit'
  | 'sold_by'
  | 'stock_qty'
  | 'unit'
>;

/**
 * Fetch the same product in other pack sizes.
 *
 * Returns an empty array rather than null so the screen has one shape to render
 * and does not need a "no alternatives" branch — the honest empty case here is
 * genuinely "the shop sells one size".
 */
export async function fetchPackOptions(product: {
  id: string;
  store_id: string;
  category_id: string | null;
  name_kn: string;
  sold_by: ProductSoldBy;
  pack_size: number | null;
  pack_unit: PackUnit | null;
}): Promise<PackOptionRow[]> {
  // A piece product has no pack sizes to compare, and a product with no declared
  // pack has no scale to compare on. Ask nothing, so the network is not touched.
  if (product.sold_by !== 'measure' || product.pack_size === null || product.pack_unit === null) {
    return [];
  }

  let query = supabase
    .from('products')
    .select('id, name_en, name_kn, price_paise, pack_size, pack_unit, sold_by, stock_qty, unit')
    .eq('store_id', product.store_id)
    .eq('name_kn', product.name_kn)
    .eq('sold_by', 'measure')
    .eq('is_active', true)
    .neq('id', product.id);

  query = product.category_id
    ? query.eq('category_id', product.category_id)
    : query.is('category_id', null);

  const { data, error } = await query;
  if (error) throw error;

  const mine = packInBase(product.pack_size, product.pack_unit);

  // Smallest first, which is how a shelf is read, and how the chips should read.
  return ((data ?? []) as PackOptionRow[])
    .filter((row) => row.pack_size !== null && row.pack_unit !== null)
    .filter((row) => {
      const theirs = packInBase(row.pack_size, row.pack_unit);
      // Never offer the size the customer is already looking at. Two rows with the
      // same base size but different spellings (1 kg and 1000 g) are the same
      // offer, and showing both would be a bug the customer would read as one.
      return theirs !== null && theirs !== mine;
    })
    .sort((a, b) => {
      const left = packInBase(a.pack_size, a.pack_unit) ?? 0;
      const right = packInBase(b.pack_size, b.pack_unit) ?? 0;
      return left - right;
    });
}

export function usePackOptions(
  productId: string,
  product:
    | {
        id: string;
        store_id: string;
        category_id: string | null;
        name_kn: string;
        sold_by: ProductSoldBy;
        pack_size: number | null;
        pack_unit: PackUnit | null;
      }
    | undefined,
) {
  return useQuery<PackOptionRow[]>({
    queryKey: packOptionKeys.forProduct(productId),
    enabled: Boolean(product && product.sold_by === 'measure'),
    queryFn: () => fetchPackOptions(product!),
    staleTime: 60_000,
  });
}
