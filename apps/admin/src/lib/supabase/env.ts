/**
 * The one place the admin panel reads its Supabase settings.
 *
 * Only the PUBLIC key belongs here. Next.js inlines anything named
 * `NEXT_PUBLIC_*` into the browser bundle, and the `service_role` /
 * `sb_secret_...` key bypasses every Row Level Security policy, so it must never
 * appear in this app (see AGENTS.md §4). The admin panel signs in as a real user
 * whose `profiles.role = 'admin'`, so RLS still applies.
 *
 * Supabase has renamed this key over time, so both spellings are accepted:
 *   NEXT_PUBLIC_SUPABASE_ANON_KEY          the original `anon` key
 *   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY   the newer `sb_publishable_...` key
 *   NEXT_PUBLIC_SUPABASE_KEY               what some dashboards tell you to use
 * All three are public keys with identical power. Whichever you have, this
 * module finds it — the same way apps/mobile/src/lib/supabase.ts does.
 */

export const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';

export const supabasePublishableKey =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_KEY ??
  '';

/** Only ever name the variables that were tried, never their values. */
const ENV_NAMES_TRIED = [
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
  'NEXT_PUBLIC_SUPABASE_KEY',
];

export const isSupabaseConfigured =
  supabaseUrl.startsWith('http') && supabasePublishableKey.length > 20;

if (!isSupabaseConfigured) {
  console.warn(
    `[supabase] Not configured. apps/admin/.env needs NEXT_PUBLIC_SUPABASE_URL and one of: ${ENV_NAMES_TRIED.join(', ')}.`,
  );
}
