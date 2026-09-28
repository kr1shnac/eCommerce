/**
 * Stands in for `@react-native-async-storage/async-storage` when the real
 * `apps/mobile/src/lib/supabase.ts` is loaded under plain Node.
 *
 * The native package needs a phone. What matters for `check-session-persistence.mjs`
 * is only its shape: one module-level store, shared by every importer, with
 * getItem/setItem/removeItem returning promises. That is what "the device store"
 * means to `@supabase/auth-js`.
 *
 * This file is only reached through `./hooks.mjs`, which is only loaded by
 * `npm run check:session`. Nothing in the app imports it.
 */
const store = new Map();

const AsyncStorage = {
  getItem: async (key) => (store.has(key) ? store.get(key) : null),
  setItem: async (key, value) => void store.set(key, String(value)),
  removeItem: async (key) => void store.delete(key),
  clear: async () => void store.clear(),
};

export default AsyncStorage;
export const useAsyncStorage = () => AsyncStorage;
