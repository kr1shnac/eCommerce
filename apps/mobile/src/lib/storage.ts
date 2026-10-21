import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * The one place the app is allowed to touch persistent device storage.
 *
 * WHY THIS FILE EXISTS (a real crash, not a hypothetical)
 * ------------------------------------------------------
 * `app.json` sets `"web": { "output": "static" }`, so `expo start` PRERENDERS
 * the app in Node to produce the web build. There is no `window` in Node.
 *
 * `@react-native-async-storage/async-storage` ships a *web* build whose methods
 * call `window.localStorage` directly. So the moment `src/lib/supabase.ts`
 * called `createClient({ auth: { storage: AsyncStorage } })`, the Node
 * prerender threw:
 *
 *     ReferenceError: window is not defined
 *       at Object.getItem (AsyncStorage.js)
 *       at SupabaseAuthClient.__loadSession
 *
 * and `npm run mobile` exited with code 7 before a phone ever connected. The
 * app on the phone was never broken — only the desktop dev server, because it
 * insists on building a target this shop does not ship.
 *
 * THE FIX, AND WHY IT IS SHAPED THIS WAY
 * --------------------------------------
 * A device gets the real AsyncStorage. A runtime with no `window` (the Node
 * prerender, a test runner) gets an in-memory object with the same shape. That
 * is deliberate and safe rather than clever:
 *
 *   * In Node the session is simply not persisted — which is correct. There is
 *     no device to persist it to, and nothing is ever read back.
 *   * On the phone `window`-less never happens, so the real store is always
 *     used, and register C2 (the session surviving a restart) is untouched.
 *   * The check is `typeof window`, not `__DEV__`, because the failure is about
 *     the *runtime*, not the build type: a release web build in Node would hit
 *     exactly the same crash.
 *
 * This is also why it is a module of its own: `supabase.ts` and
 * `query-persistence.ts` both need device storage, and the guard must not be
 * written twice or drift.
 */

/** True when there is a browser-like global to store to. */
export function hasDeviceStorage(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

type StorageLike = {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
  removeItem: (key: string) => Promise<void>;
};

/**
 * Shape-compatible stand-in used only where there is no device store. It keeps
 * values for the life of the process so a single Node run stays coherent (e.g.
 * a sign-in followed by a read within the same prerender), and writes them
 * nowhere.
 */
function createMemoryStorage(): StorageLike {
  const store = new Map<string, string>();
  return {
    getItem: async (key) => (store.has(key) ? (store.get(key) as string) : null),
    setItem: async (key, value) => void store.set(key, String(value)),
    removeItem: async (key) => void store.delete(key),
  };
}

/**
 * What every caller should use. On a phone this is the real AsyncStorage; in
 * Node it is an in-memory object of the same shape.
 */
export const deviceStorage: StorageLike = hasDeviceStorage()
  ? (AsyncStorage as unknown as StorageLike)
  : createMemoryStorage();
