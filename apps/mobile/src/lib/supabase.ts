import { createClient } from '@supabase/supabase-js';

import { deviceStorage } from '@/lib/storage';
import type { Database } from '@/types/database';

/**
 * Only the PUBLIC key belongs in this file. Never put the service_role key in
 * the app: anything shipped inside an app can be read by the user, and the
 * service_role key bypasses every Row Level Security policy.
 *
 * Supabase has renamed this key over time, so all three spellings are accepted:
 *   EXPO_PUBLIC_SUPABASE_ANON_KEY           the original `anon` key
 *   EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY    the newer `sb_publishable_...` key
 *   EXPO_PUBLIC_SUPABASE_KEY                what some dashboards tell you to use
 * All three are public keys with identical power. Whichever you have, this
 * module finds it.
 */

const url = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';

const anonKey =
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ??
  process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  process.env.EXPO_PUBLIC_SUPABASE_KEY ??
  '';

/** Only ever name the variables that were tried, never their values. */
const ENV_NAMES_TRIED = [
  'EXPO_PUBLIC_SUPABASE_ANON_KEY',
  'EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
  'EXPO_PUBLIC_SUPABASE_KEY',
];

export const isSupabaseConfigured = url.startsWith('http') && anonKey.length > 20;

if (!isSupabaseConfigured && __DEV__) {
  // Never print the value of a key, not even a public one.
  console.warn(
    `[supabase] Not configured. apps/mobile/.env needs EXPO_PUBLIC_SUPABASE_URL and one of: ${ENV_NAMES_TRIED.join(', ')}.`,
  );
}

/**
 * Placeholder values keep the app from crashing when .env is missing; every
 * screen must check `isSupabaseConfigured` first and show setup instructions.
 */
export const supabase = createClient<Database>(
  isSupabaseConfigured ? url : 'http://127.0.0.1:54321',
  isSupabaseConfigured ? anonKey : 'missing-anon-key',
  {
    auth: {
      /**
       * WITHOUT THIS LINE, NOBODY STAYS SIGNED IN.
       *
       * `@supabase/auth-js` only uses `globalThis.localStorage` when it exists
       * and is writable; otherwise it keeps the session in a plain in-memory
       * object (`memoryLocalStorageAdapter`). React Native has no
       * `localStorage`, so the session was thrown away the moment the app was
       * killed: the customer had to sign in again on every cold start. The
       * language and the cart survived a restart; the login did not.
       *
        * AsyncStorage is the same device store the cart (`src/store/cart-store.ts`)
        * and the theme choice (`src/store/theme-store.ts`) already persist to, so
        * this adds no new dependency and no new place where data lives.
        *
        * It comes from `@/lib/storage` rather than straight from the package,
        * because the package's web build touches `window` and `expo start`
        * prerenders this file in Node — see that module for the crash it caused.
        */
      storage: deviceStorage,
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
      // PKCE is what the OTP / magic-link round trip expects, and there is no
      // browser URL to detect a session in on a phone.
      flowType: 'pkce',
    },
  },
);