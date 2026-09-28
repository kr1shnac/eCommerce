#!/usr/bin/env node
/**
 * check-session-persistence.mjs — does the login survive a cold start?
 *
 * Run:  npm run check:session
 *
 * WHY THIS EXISTS
 *
 * `apps/mobile/src/lib/supabase.ts` had `persistSession: true` and no `storage`
 * adapter. `@supabase/auth-js` only uses `globalThis.localStorage` when it exists
 * and is writable, and otherwise keeps the session in a plain per-instance object
 * (`memoryLocalStorageAdapter`). React Native has no `localStorage`, so the session
 * was thrown away on every cold start: the customer signed in again every time.
 * Nothing on a build machine could see that, which is why this check exists.
 *
 * WHAT IT PROVES
 *
 *   1. On a React-Native-like runtime (no `globalThis.localStorage`),
 *      `@supabase/auth-js` with `persistSession: true` and no `storage` option
 *      resolves to a per-instance in-memory store, so a second client instance —
 *      the app after a cold start — sees nothing. That is the old defect.
 *   2. Passing `storage: AsyncStorage` (the genuine npm package) fixes exactly
 *      that: two instances share the store and a fresh instance recovers the
 *      session.
 *   3. The real `apps/mobile/src/lib/supabase.ts` hands a storage adapter to
 *      `createClient`, and a fresh client over that same store recovers the
 *      session while a client without the option loses it.
 *   4. Control: with window + document + localStorage present, auth-js finds
 *      `localStorage` on its own — which is why the defect is invisible in a
 *      browser / Expo web and only bites on the phone.
 *
 * What it does NOT prove: that the app renders, that sign-in works, or that the
 * native AsyncStorage store works on an Android phone. A real device run is the
 * only thing that proves those (`PRODUCTION.md` §5).
 *
 * Caveat, kept honest: Node's CJS/ESM interop is not Metro's, so the genuine
 * AsyncStorage package cannot be handed straight to the app module here (it
 * arrives as the `{ default, useAsyncStorage }` namespace object). Sections 1-2
 * therefore use the genuine package, and section 3 substitutes a one-object
 * stand-in for the *native* store — the part a Linux box cannot supply.
 *
 * Run: node --import ./scripts/node-hooks/register.mjs ./scripts/check-session-persistence.mjs
 * (that is what `npm run check:session` does)
 *
 * Expect one harmless warning: `[MODULE_TYPELESS_PACKAGE_JSON]` about
 * `apps/mobile/src/lib/supabase.ts`. The app is a Metro project, so
 * `apps/mobile/package.json` must not become `"type": "module"` to silence it.
 */
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(join(root, 'apps/mobile/package.json'));
const APP_MODULE = pathToFileURL(join(root, 'apps/mobile/src/lib/supabase.ts')).href;

let failures = 0;
function expect(name, ok, detail = '') {
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

// ---------------------------------------------------------------------------
// 1. A React-Native-like runtime.
// ---------------------------------------------------------------------------
// Hermes has no `window` and no `globalThis.localStorage`. AsyncStorage's Node
// entry point resolves to its *web* shim, which reads `window.localStorage`, so we
// give it one backed by a Map to exercise the genuine package. Supplying a
// `window` does not make auth-js find a session store of its own: its
// `supportsLocalStorage()` also requires `document`, and `globalThis.localStorage`
// stays undefined — which is exactly the phone.
const backing = new Map();
const fakeLocalStorage = {
  getItem: (k) => (backing.has(k) ? backing.get(k) : null),
  setItem: (k, v) => void backing.set(k, String(v)),
  removeItem: (k) => void backing.delete(k),
};
globalThis.window = { localStorage: fakeLocalStorage };

expect('runtime has no globalThis.localStorage', typeof globalThis.localStorage === 'undefined');
expect('runtime has no document', typeof globalThis.document === 'undefined');

const AsyncStorage = require('@react-native-async-storage/async-storage').default;
const { createClient } = require('@supabase/supabase-js');

const URL_ = 'https://example.supabase.co';
const KEY = 'k'.repeat(30); // any string longer than 20 characters reads as "configured"

const storageKey = createClient(URL_, KEY).auth.storageKey;
expect('storageKey resolved', storageKey === 'sb-example-auth-token', storageKey);

// A session in the shape auth-js accepts (`_isValidSession` wants access_token,
// refresh_token and expires_at; recovery also needs it unexpired).
const session = {
  access_token: 'header.payload.signature',
  token_type: 'bearer',
  expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  refresh_token: 'refresh-token-for-this-check',
  user: {
    id: '00000000-0000-0000-0000-000000000001',
    aud: 'authenticated',
    role: 'authenticated',
    phone: '+919999999999',
    app_metadata: {},
    user_metadata: {},
    identities: [],
    created_at: new Date().toISOString(),
  },
};

// Exactly the auth options the app had before the fix.
const oldAuthOptions = {
  persistSession: true,
  autoRefreshToken: false,
  detectSessionInUrl: false,
  flowType: 'pkce',
};

// ---------------------------------------------------------------------------
// 2. BEFORE and AFTER, with the genuine package.
// ---------------------------------------------------------------------------
const before1 = createClient(URL_, KEY, { auth: oldAuthOptions });
const before2 = createClient(URL_, KEY, { auth: oldAuthOptions });

expect(
  'BEFORE: the resolved store is an in-memory shim, not a device store',
  typeof before1.auth.storage.getItem === 'function' && before1.auth.storage !== AsyncStorage,
  before1.auth.storage.constructor?.name ?? typeof before1.auth.storage,
);
expect('BEFORE: two client instances do NOT share a store', before1.auth.storage !== before2.auth.storage);

await before1.auth.storage.setItem(storageKey, JSON.stringify(session));
const before1Session = await before1.auth.getSession();
expect(
  'BEFORE: the first instance can read the session it wrote',
  before1Session.data.session?.access_token === session.access_token,
);
const before2Session = await before2.auth.getSession();
expect(
  'BEFORE (the cold start): a fresh instance sees NOTHING',
  before2Session.data.session === null,
  'the customer would be signed out on every app launch',
);

const after1 = createClient(URL_, KEY, { auth: { ...oldAuthOptions, storage: AsyncStorage } });
const after2 = createClient(URL_, KEY, { auth: { ...oldAuthOptions, storage: AsyncStorage } });

expect('AFTER: the resolved store IS the AsyncStorage package', after1.auth.storage === AsyncStorage);
expect('AFTER: two client instances share the same store', after1.auth.storage === after2.auth.storage);

await after1.auth.storage.setItem(storageKey, JSON.stringify(session));
const after2Session = await after2.auth.getSession();
expect(
  'AFTER (the cold start): a fresh instance recovers the session',
  after2Session.data.session?.access_token === session.access_token,
  after2Session.data.session?.user?.phone ?? 'none',
);

// ---------------------------------------------------------------------------
// 3. The real module under test.
// ---------------------------------------------------------------------------
// `scripts/node-hooks/hooks.mjs` makes this bare specifier resolve to the stand-in for the
// *native* store, so the app module gets a real adapter object, the way Metro
// gives it one on a phone.
const nativeStore = (await import('@react-native-async-storage/async-storage')).default;
expect(
  'stand-in for the native store is in place',
  typeof nativeStore?.getItem === 'function' && typeof nativeStore?.setItem === 'function',
);

process.env.EXPO_PUBLIC_SUPABASE_URL = URL_;
process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_not_a_real_key_0000000000';

const app = await import(APP_MODULE);
expect('app module reports itself configured', app.isSupabaseConfigured === true);
expect(
  'apps/mobile/src/lib/supabase.ts passes the device store to createClient',
  app.supabase.auth.storage === nativeStore,
);

const realKey = app.supabase.auth.storageKey;
await app.supabase.auth.storage.setItem(realKey, JSON.stringify(session));
const restarted = createClient(URL_, KEY, {
  auth: { ...oldAuthOptions, storage: nativeStore, storageKey: realKey },
});
const restartedSession = await restarted.auth.getSession();
expect(
  'real module: the session survives a restart',
  restartedSession.data.session?.access_token === session.access_token,
);
const withoutAdapter = createClient(URL_, KEY, { auth: { ...oldAuthOptions, storageKey: realKey } });
const lost = await withoutAdapter.auth.getSession();
expect('real module: without the adapter the same session is lost', lost.data.session === null);

// ---------------------------------------------------------------------------
// 4. Control: why the bug was invisible in a browser / Expo web.
// ---------------------------------------------------------------------------
globalThis.localStorage = fakeLocalStorage;
globalThis.document = {}; // `supportsLocalStorage()` requires window AND document
const browser = createClient(URL_, KEY, { auth: oldAuthOptions });
expect(
  'CONTROL: with window + document + localStorage, no `storage` option is needed',
  browser.auth.storage === fakeLocalStorage,
);

console.log(failures === 0 ? '\nRESULT: all checks passed' : `\nRESULT: ${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
