import { supabase } from '@/lib/supabase';

/**
 * Development-only sign-in — scaffolding for looking at the app, not a feature.
 *
 * The app signs in with a phone number and a one-time code, which needs an SMS
 * provider. Until one is configured there are no accounts at all, so the
 * customer's order history, the rider's pool and the owner's board are all
 * behind a door nobody can open. That makes the app impossible to look at.
 *
 * So in development the login screen offers the three accounts that
 * `supabase/demo-accounts.sql` creates. They sign in by email, because email is
 * the one auth provider the project has switched on.
 *
 * Where the credentials live, and why:
 *   * the addresses come from `EXPO_PUBLIC_DEMO_*` in the git-ignored `.env`,
 *     so no account is ever written into the source or the repository;
 *   * the block is behind `__DEV__`, so a production build cannot show it even
 *     if the variables are still set;
 *   * an address that is not in `.env` simply does not appear as a button.
 *
 * To remove it: delete the `EXPO_PUBLIC_DEMO_*` lines from `apps/mobile/.env`.
 */

export type DemoRole = 'customer' | 'delivery' | 'admin';

export type DemoAccount = {
  role: DemoRole;
  /** i18n key for the button, on the login screen. */
  labelKey: string;
  email: string;
};

/** One password for all three, because demo-accounts.sql takes one. */
const demoPassword = process.env.EXPO_PUBLIC_DEMO_PASSWORD ?? '';

const configured: { role: DemoRole; labelKey: string; email: string | undefined }[] = [
  {
    role: 'customer',
    labelKey: 'auth.demo.customer',
    email: process.env.EXPO_PUBLIC_DEMO_CUSTOMER_EMAIL,
  },
  {
    role: 'delivery',
    labelKey: 'auth.demo.delivery',
    email: process.env.EXPO_PUBLIC_DEMO_DELIVERY_EMAIL,
  },
  {
    role: 'admin',
    labelKey: 'auth.demo.admin',
    email: process.env.EXPO_PUBLIC_DEMO_ADMIN_EMAIL,
  },
];

export const demoAccounts: DemoAccount[] = configured
  .filter((account): account is DemoAccount => Boolean(account.email))
  .map((account) => ({ ...account, email: account.email as string }));

/** True only in development, and only once accounts were actually configured. */
export const demoSignInAvailable =
  __DEV__ && demoPassword.length > 0 && demoAccounts.length > 0;

export async function signInAsDemo(account: DemoAccount): Promise<void> {
  const { error } = await supabase.auth.signInWithPassword({
    email: account.email,
    password: demoPassword,
  });
  if (error) throw error;
  // The auth listener in the root layout picks the new session up; there is
  // nothing to set here, exactly like the one-time-code path.
}
