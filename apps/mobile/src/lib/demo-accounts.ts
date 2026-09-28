import { supabase } from '@/lib/supabase';

/**
 * Development-only sign-in — scaffolding for looking at the app, and the door
 * the store reviewers come through.
 *
 * The app signs in with a phone number and a one-time code, which needs an SMS
 * provider. Until one is configured (and funded, and DLT-registered) there are no
 * accounts at all, so the customer's order history, the rider's pool and the
 * owner's board would all be behind a door nobody can open — including the person
 * reviewing the app for the App Store (register C8: Apple's guideline 2.1(a)
 * expects a working demo login, and Google asks for credentials too).
 *
 * So the login screen can offer the three accounts that
 * `supabase/demo-accounts.sql` creates. They sign in by email, because email is
 * the one auth provider the project has switched on.
 *
 * THERE ARE TWO SWITCHES, AND THEY ARE NOT THE SAME ONE.
 *
 *   `demoSignInAvailable`  — the everyday one. `__DEV__` only, so it is compiled
 *                            out of every release build. This is the one used
 *                            while building the app.
 *
 *   `reviewSignInAvailable` — the store-submission one. NOT tied to `__DEV__`,
 *                            because a release build is the whole point: it is
 *                            the binary the reviewer installs. It turns on only
 *                            when `EXPO_PUBLIC_REVIEW_EMAIL` and
 *                            `EXPO_PUBLIC_REVIEW_PASSWORD` are both set, which
 *                            they are only for a review build made with that
 *                            environment. Turned off again by unsetting them, so
 *                            a normal `production` build has no such door.
 *
 * Where the credentials live, and why:
 *   * nothing is ever written into the source or the repository — every address
 *     and the password come from the git-ignored `.env`;
 *   * an address that is not set simply does not appear as a button;
 *   * the reviewer account is ONE account with the customer role. It must never
 *     be an admin: a store reviewer poking at the owner's board is a support
 *     ticket waiting to happen, and `profiles.role` is enforced in the database,
 *     so the choice here cannot be escalated.
 *
 * To remove it: delete the `EXPO_PUBLIC_DEMO_*` / `EXPO_PUBLIC_REVIEW_*` lines
 * from `apps/mobile/.env`, and use an EAS environment without them.
 */

export type DemoRole = 'customer' | 'delivery' | 'admin' | 'review';

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

/**
 * The three dev accounts.
 *
 * Empty in a release build, on purpose: the credentials should not merely be
 * unreachable there, they should not be in the bundle at all. `__DEV__` is
 * inlined as `false` by Metro for a release, so this evaluates to `[]` and the
 * addresses below are dropped as dead code.
 */
export const demoAccounts: DemoAccount[] = __DEV__
  ? configured
      .filter((account): account is DemoAccount => Boolean(account.email))
      .map((account) => ({ ...account, email: account.email as string }))
  : [];

/** True only in development, and only once accounts were actually configured. */
export const demoSignInAvailable =
  __DEV__ && demoPassword.length > 0 && demoAccounts.length > 0;

/**
 * The single door left open for a store reviewer, in a release build.
 *
 * Deliberately one account and one password, both supplied by the environment at
 * build time. `null` means no door — which is the state of every ordinary
 * production build, and the state the app should ship in once it is live.
 */
export const reviewAccount: DemoAccount | null =
  process.env.EXPO_PUBLIC_REVIEW_EMAIL && process.env.EXPO_PUBLIC_REVIEW_PASSWORD
    ? {
        role: 'review',
        labelKey: 'auth.review.signIn',
        email: process.env.EXPO_PUBLIC_REVIEW_EMAIL,
      }
    : null;

export const reviewSignInAvailable = reviewAccount !== null;

export async function signInAsDemo(account: DemoAccount): Promise<void> {
  const password = account.role === 'review'
    ? (process.env.EXPO_PUBLIC_REVIEW_PASSWORD ?? '')
    : demoPassword;

  const { error } = await supabase.auth.signInWithPassword({
    email: account.email,
    password,
  });
  if (error) throw error;
  // The auth listener in the root layout picks the new session up; there is
  // nothing to set here, exactly like the one-time-code path.
}
