import { deviceStorage } from '@/lib/storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

/**
 * THE CART STORES NO PRICES.
 *
 * Only `{ productId: quantity }` is saved. Every price the customer ever sees is
 * read live from the `products` table, because a basket built yesterday may be
 * checked out today at a different price, and because the database is what
 * charges the money anyway. See AGENTS.md rule 9.1.
 *
 * Quantities are capped at what is on the shelf by `useCart`; the store only
 * knows the shape, not the stock.
 */

const STORAGE_KEY = 'kunigal-cart-v1';
/** A shopper who wants 100 packs of milk is not shopping, they are scraping us. */
const MAX_LINES = 100;

type CartState = {
  /** product id -> quantity */
  items: Record<string, number>;
  /** False until AsyncStorage has been read, so we never render an empty cart. */
  hasHydrated: boolean;
  setHasHydrated: (value: boolean) => void;
  add: (productId: string, by?: number) => void;
  setQuantity: (productId: string, quantity: number) => void;
  remove: (productId: string) => void;
  clear: () => void;
  /** Put a whole list into the bag at once — used by "Reorder". */
  replaceAll: (items: Record<string, number>) => void;
};

export const useCartStore = create<CartState>()(
  persist(
    (set) => ({
      items: {},
      hasHydrated: false,

      setHasHydrated: (value) => set({ hasHydrated: value }),

      add: (productId, by = 1) =>
        set((state) => {
          const next = (state.items[productId] ?? 0) + by;
          if (next <= 0) {
            const { [productId]: _removed, ...rest } = state.items;
            return { items: rest };
          }
          return { items: { ...state.items, [productId]: next } };
        }),

      setQuantity: (productId, quantity) =>
        set((state) => {
          if (quantity <= 0) {
            const { [productId]: _removed, ...rest } = state.items;
            return { items: rest };
          }
          return { items: { ...state.items, [productId]: quantity } };
        }),

      remove: (productId) =>
        set((state) => {
          const { [productId]: _removed, ...rest } = state.items;
          return { items: rest };
        }),

      clear: () => set({ items: {} }),

      replaceAll: (items) =>
        set(() => {
          const next: Record<string, number> = {};
          let lines = 0;
          for (const [productId, quantity] of Object.entries(items)) {
            if (lines >= MAX_LINES) break;
            const whole = Math.floor(quantity);
            if (!Number.isFinite(whole) || whole <= 0) continue;
            next[productId] = whole;
            lines += 1;
          }
          return { items: next };
        }),
    }),
    {
      name: STORAGE_KEY,
      storage: createJSONStorage(() => deviceStorage),
      // hasHydrated is about this run, not something to restore from disk.
      partialize: (state) => ({ items: state.items }),
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true);
      },
    },
  ),
);

/** Total number of units, for the badge on the Cart tab. */
export function selectCartCount(state: CartState): number {
  return Object.values(state.items).reduce((total, quantity) => total + quantity, 0);
}

export function selectCartLineCount(state: CartState): number {
  return Object.keys(state.items).length;
}

export { MAX_LINES };