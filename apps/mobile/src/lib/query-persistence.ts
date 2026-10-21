import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import type { Query } from '@tanstack/react-query';
import { QueryClient } from '@tanstack/react-query';

import { deviceStorage } from '@/lib/storage';

/**
 * The catalogue survives closing the app (register M1).
 *
 * THE PROBLEM. The app targets patchy rural 4G, which is why `OfflineBanner`
 * exists and why AGENTS §9.3 is a rule. But the banner only helps a customer who
 * is *already* in the app: React Query's cache lives in memory, so it dies with
 * the process. A customer who opens the app in a dead spot gets a spinner, then
 * an error — the shop's shelves are a blank page, even though they were fetched
 * ten minutes ago. In a town where "check the price on my phone" happens in a
 * courtyard with one bar, that is the difference between the app being useful and
 * being a thing you open at home.
 *
 * THE FIX. Persist the cache to the device, and hydrate it on the next cold
 * start, so the shelves are on screen immediately and the network only has to
 * *refresh* them. This is called a stale-while-revalidate cache, and the visible
 * effect is: open offline → the catalogue is there with a quiet offline banner →
 * it silently corrects itself when a bar appears.
 *
 * ---------------------------------------------------------------------------
 * WHAT IS PERSISTED, AND WHY THAT LIST IS SHORT (the security part)
 * ---------------------------------------------------------------------------
 * `shouldDehydrateQuery` is an **allowlist**, not a denylist, and that is
 * deliberate. `AsyncStorage` is a plain file on the device: it survives
 * uninstall-free downgrades, it is readable on a rooted phone, and it is not
 * cleared when a customer signs out unless something clears it. So the question
 * is not "what is safe to lose" but "what must never be written to a plain file".
 *
 * Persisted — all of it public shop data, identical for every customer, and
 * already visible to anyone with the publishable key:
 *   * `categories` — the aisle list.
 *   * `products`   — the shelves (name, price, stock, image).
 *   * `product`    — one product's detail page.
 *
 * NOT persisted — everything that belongs to a person:
 *   * `orders`, `order` — a customer's order history, and the delivery address
 *     snapshot inside it. This is the one that would matter most: a plain file on
 *     a shared phone holding where somebody lives. AGENTS §9.6 and the DPDP Act
 *     both say no.
 *   * `addresses`, `profile`, `rider*`, `shelf`, `shop-totals`, `coupons` — either
 *     personal or staff-only. Staff data on a customer's device would be a
 *     disclosure; a rider's pool cached on a lost phone is a list of addresses.
 *
 * A denylist was rejected: the day somebody adds `useSomethingSensitive`, a
 * denylist silently persists it and nobody notices. An allowlist fails closed —
 * a new query key is simply not cached, and the worst case is a slower screen.
 */

/**
 * The root of every query key that may be written to the device. Keep this list
 * short; adding to it is a security decision, not a performance one.
 */
const PERSISTED_ROOTS = ['categories', 'products', 'product'] as const;

/**
 * How long a saved catalogue is trusted. Seven days is chosen to be generous on
 * purpose: prices in a one-shop town do not move daily, and a week-old price that
 * is *visible* (with the shop's own "call us" a tap away) is far better than a
 * blank screen. The database remains authoritative — this cache is only ever
 * shown, never used to compute what a customer is charged (§9.1: the price on an
 * order comes from `products` at write time, in Postgres).
 */
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Bump this by hand when a persisted shape changes in a way old data would
 * misrender — for example if `Product` gains a field a screen assumes is present.
 * A different buster makes the app discard the old cache rather than decode it.
 */
const BUSTER = 'v1';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      staleTime: 60_000,
      // Must be >= MAX_AGE_MS, or React Query garbage-collects a query from memory
      // before the persister is given a chance to restore it. This is the single
      // most common way this feature silently does nothing.
      gcTime: MAX_AGE_MS,
    },
  },
});

export const persister = createAsyncStoragePersister({
  // Goes through `@/lib/storage` so a Node prerender (which has no `window`)
  // does not crash the dev server — see that module.
  storage: deviceStorage,
  // Namespaced so it cannot collide with the auth session, which
  // `src/lib/supabase.ts` also keeps in AsyncStorage under `sb-…-auth-token`.
  key: 'kunigal-query-cache',
});

/**
 * Decide, query by query, whether it may be written to the device.
 *
 * Exported (rather than inline in the provider) because it is the rule that
 * matters most here and it deserves its own test — see `check:view`'s sibling
 * checks. A mistake in this function is a privacy incident, not a slow screen.
 */
export function shouldPersistQuery(query: Pick<Query, 'queryKey'>): boolean {
  // Defensive read on purpose. This runs from the serialisation path during
  // hydration, before the first paint — a throw here is an app that does not
  // open at all, the worst failure this feature could introduce. The test
  // `check:persist` pins it, and it found this bug: the first version was
  // `query.queryKey[0]`, which throws on a query object with no `queryKey`.
  const key = query?.queryKey;
  if (!Array.isArray(key)) return false;
  const root = key[0];
  return typeof root === 'string' && (PERSISTED_ROOTS as readonly string[]).includes(root);
}

export const persistOptions = {
  persister,
  maxAge: MAX_AGE_MS,
  buster: BUSTER,
  dehydrateOptions: {
    shouldDehydrateQuery: shouldPersistQuery,
  },
};
