import { deviceStorage } from '@/lib/storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { usableSaved, type QuantityMap } from '@/lib/saved-later';

/**
 * The "save for later" shelf: what the customer set aside, on this phone.
 *
 * WHY IT LIVES HERE AND NOT IN THE DATABASE
 * -----------------------------------------
 * A customer hesitates over an item while **offline** more often than not — a
 * village with one bar of signal is the case this app is built for. Saving for
 * later is the act of taking something out of the bag, and that must work with
 * no network; the moment it needs a round trip it stops working exactly when it
 * is needed. It is also the same trust model as the cart itself
 * (`store/cart-store.ts`), which is device-local for the same reason.
 *
 * It stores no prices, no stock and no names: only `{ productId: quantity }`,
 * joined against live product rows by `hooks/use-cart.ts`. A saved line that
 * has since sold out is reported like any other unavailable line, never
 * silently kept as if it could still be bought.
 */

const STORAGE_KEY = 'kunigal-saved-v1';

export type SavedState = {
  /** product id -> the quantity the customer last wanted. */
  items: QuantityMap;
  /** False until the device has been read, so we never render "nothing saved". */
  hasHydrated: boolean;
  setHasHydrated: (value: boolean) => void;
  /** Set aside one line. `by` defaults to 1. */
  save: (productId: string, by?: number) => void;
  /** Take one line off the shelf for good. */
  forget: (productId: string) => void;
  clear: () => void;
};

export const useSavedStore = create<SavedState>()(
  persist(
    (set) => ({
      items: {},
      hasHydrated: false,

      setHasHydrated: (value) => set({ hasHydrated: value }),

      save: (productId, by = 1) =>
        set((state) => {
          const whole = Math.floor(by);
          if (!Number.isFinite(whole) || whole <= 0) return state;
          return { items: { ...state.items, [productId]: whole } };
        }),

      forget: (productId) =>
        set((state) => {
          if (state.items[productId] === undefined) return state;
          const { [productId]: _removed, ...rest } = state.items;
          return { items: rest };
        }),

      clear: () => set({ items: {} }),
    }),
    {
      name: STORAGE_KEY,
      storage: createJSONStorage(() => deviceStorage),
      partialize: (state) => ({ items: state.items }),
      onRehydrateStorage: () => (state) => {
        // A half-written file degrades to an empty shelf, not to a crash on
        // launch. `usableSaved` is the pure half, covered by check:saved.
        useSavedStore.setState({
          items: state ? usableSaved(state.items) : {},
          hasHydrated: true,
        });
      },
    },
  ),
);

/** How many lines are set aside — shown on the cart's saved section. */
export function selectSavedLineCount(state: SavedState): number {
  return Object.keys(state.items).length;
}
