import { createClient } from '@supabase/supabase-js';

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
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
      // How long to keep retrying a refresh before giving up, so a customer on a
      // patchy connection sees the offline banner instead of a hang.
      flowType: 'pkce',
    },
  },
);