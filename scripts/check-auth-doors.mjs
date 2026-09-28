#!/usr/bin/env node
/**
 * check-auth-doors.mjs — who can get into a release build?
 *
 * Run:  npm run check:auth-doors
 *
 * WHY THIS EXISTS
 *
 * The app's only real sign-in is phone OTP, and OTP is switched off until an SMS
 * provider is funded and DLT-registered. So there are two scaffolded doors:
 *
 *   * the dev demo accounts  — must NEVER appear in a release build;
 *   * the reviewer account   — MUST appear in the store-submission build, and
 *                              must NOT appear in a plain production build.
 *
 * Both are decided by `apps/mobile/src/lib/demo-accounts.ts`, which reads
 * `__DEV__` and `EXPO_PUBLIC_*` at bundle time. Getting that file wrong is not a
 * cosmetic bug: a dev account left in a release is a published login, and a
 * missing reviewer account is an App Store rejection (guideline 2.1(a)).
 *
 * WHAT IT PROVES
 *
 * The real module is imported under Node several times, each time with a
 * different combination of `__DEV__` and environment — exactly the combinations
 * the build profiles produce — and the resulting doors are asserted:
 *
 *   1. plain production  (__DEV__ false, no review vars) -> NO door at all
 *   2. review build      (__DEV__ false, review vars set) -> exactly one door,
 *                                                             role `customer`-ish
 *                                                             `review`, not admin
 *   3. half-configured   (only one review var)            -> NO door
 *   4. development       (__DEV__ true, demo vars set)    -> the three dev doors
 *   5. development, prod-danger (__DEV__ false, demo vars set) -> NO door
 *
 * Case 5 is the important one: setting the demo variables in an EAS environment
 * must not, by itself, open a door in a release build.
 *
 * What it does NOT prove: that Supabase accepts the credentials, or that the
 * button renders. Only a device run and a real reviewer sign-in prove those.
 *
 * The module is re-imported with a cache-busting query so each case gets a fresh
 * evaluation; `__DEV__` is a global under Metro, so it is set on `globalThis`
 * here in the same way.
 */
import { pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const MODULE = pathToFileURL(join(root, 'apps/mobile/src/lib/demo-accounts.ts')).href;

let failures = 0;
function expect(name, ok, detail = '') {
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

// `demo-accounts.ts` imports `@/lib/supabase`, which builds a real client from
// the environment. Give it something well-formed so that import cannot throw.
process.env.EXPO_PUBLIC_SUPABASE_URL ||= 'https://example.supabase.co';
process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||= 'sb_publishable_placeholder_000000000';

// The build-time globals. Metro inlines these; under Node they are just globals.
const DEMO_VARS = [
  'EXPO_PUBLIC_DEMO_PASSWORD',
  'EXPO_PUBLIC_DEMO_CUSTOMER_EMAIL',
  'EXPO_PUBLIC_DEMO_DELIVERY_EMAIL',
  'EXPO_PUBLIC_DEMO_ADMIN_EMAIL',
];
const REVIEW_VARS = ['EXPO_PUBLIC_REVIEW_EMAIL', 'EXPO_PUBLIC_REVIEW_PASSWORD'];

/** Import a fresh copy of the module for the given fake build environment. */
async function load({ dev, env }) {
  globalThis.__DEV__ = dev;
  for (const key of [...DEMO_VARS, ...REVIEW_VARS]) delete process.env[key];
  Object.assign(process.env, env);

  // Cache-bust so the module body runs again with the new globals.
  const mod = await import(`${MODULE}?case=${dev}-${Math.random()}`);
  return mod;
}

// ---------------------------------------------------------------------------
// 1. A plain production build has no door.
// ---------------------------------------------------------------------------
{
  const mod = await load({ dev: false, env: {} });
  expect('production: demoSignInAvailable is false', mod.demoSignInAvailable === false);
  expect('production: reviewSignInAvailable is false', mod.reviewSignInAvailable === false);
  expect('production: reviewAccount is null', mod.reviewAccount === null);
}

// ---------------------------------------------------------------------------
// 2. The review build has exactly one door, and it is not an admin.
// ---------------------------------------------------------------------------
{
  const env = {
    EXPO_PUBLIC_REVIEW_EMAIL: 'reviewer@example.com',
    EXPO_PUBLIC_REVIEW_PASSWORD: 'a-review-password',
  };
  const mod = await load({ dev: false, env });
  expect('review build: reviewSignInAvailable is true', mod.reviewSignInAvailable === true);
  expect('review build: the account exists', mod.reviewAccount?.email === 'reviewer@example.com');
  expect(
    'review build: the account is NOT an admin (no owner-board access)',
    mod.reviewAccount?.role === 'review',
    String(mod.reviewAccount?.role),
  );
  expect(
    'review build: the dev demo accounts still do NOT appear',
    mod.demoSignInAvailable === false && mod.demoAccounts.length === 0,
  );
}

// ---------------------------------------------------------------------------
// 3. A half-configured review build has no door.
// ---------------------------------------------------------------------------
{
  const mod = await load({ dev: false, env: { EXPO_PUBLIC_REVIEW_EMAIL: 'reviewer@example.com' } });
  expect(
    'half-configured review build (email, no password): no door',
    mod.reviewSignInAvailable === false,
  );

  const mod2 = await load({ dev: false, env: { EXPO_PUBLIC_REVIEW_PASSWORD: 'a-review-password' } });
  expect(
    'half-configured review build (password, no email): no door',
    mod2.reviewSignInAvailable === false,
  );
}

// ---------------------------------------------------------------------------
// 4. A development build gets the three dev doors and no review door.
// ---------------------------------------------------------------------------
{
  const env = {
    EXPO_PUBLIC_DEMO_PASSWORD: 'a-demo-password',
    EXPO_PUBLIC_DEMO_CUSTOMER_EMAIL: 'customer@example.com',
    EXPO_PUBLIC_DEMO_DELIVERY_EMAIL: 'rider@example.com',
    EXPO_PUBLIC_DEMO_ADMIN_EMAIL: 'owner@example.com',
  };
  const mod = await load({ dev: true, env });
  expect('development: demoSignInAvailable is true', mod.demoSignInAvailable === true);
  expect('development: three dev doors', mod.demoAccounts.length === 3, String(mod.demoAccounts.length));
  expect(
    'development: the three roles are customer, delivery, admin',
    mod.demoAccounts.map((a) => a.role).join(',') === 'customer,delivery,admin',
  );
  expect('development: no review door', mod.reviewSignInAvailable === false);
}

// ---------------------------------------------------------------------------
// 5. The one that matters: demo vars in a *release* build open no door.
// ---------------------------------------------------------------------------
{
  const env = {
    EXPO_PUBLIC_DEMO_PASSWORD: 'a-demo-password',
    EXPO_PUBLIC_DEMO_CUSTOMER_EMAIL: 'customer@example.com',
    EXPO_PUBLIC_DEMO_DELIVERY_EMAIL: 'rider@example.com',
    EXPO_PUBLIC_DEMO_ADMIN_EMAIL: 'owner@example.com',
  };
  const mod = await load({ dev: false, env });
  expect(
    'release build with EXPO_PUBLIC_DEMO_* still set: NO demo door',
    mod.demoSignInAvailable === false && mod.demoAccounts.length === 0,
  );
  expect('release build: no review door either', mod.reviewSignInAvailable === false);
}

console.log(failures === 0 ? '\nRESULT: all checks passed' : `\nRESULT: ${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
