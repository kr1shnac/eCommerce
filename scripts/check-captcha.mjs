#!/usr/bin/env node
/**
 * CAPTCHA gate guard (AGENTS.md §9, the SMS-bill rule).
 *
 * The gate is the one place where a missing piece would not look broken: the app
 * keeps working fine and simply sends paid SMS to a script. So every claim about
 * it has to be proved in a file rather than observed on a phone.
 *
 * This fails the build unless:
 *   1. all three OTP call paths — first send, resend, verify — pass a token when
 *      the gate is on. The resend path is the one usually missed: Supabase
 *      demands a token on it too, so a login that works on the first tap and
 *      dies on the second is exactly what this catches.
 *   2. no captcha secret of any kind is in the app. The SITE key is public by
 *      design (`EXPO_PUBLIC_`, in the shipped bundle); the secret must never be.
 *   3. the site key comes from the environment, never a literal, so a test key
 *      cannot be copy-pasted into a release build.
 *   4. a stale token is refused rather than sent: freshness gates the options.
 *   5. every message the gate can show exists in BOTH locales.
 *   6. the widget is only mounted when a key exists — an empty widget is a
 *      spinner that never resolves.
 *
 * What this CANNOT prove, and PRODUCTION.md says so: that Cloudflare's script
 * actually renders inside the WebView on a real device. That needs a device and
 * a real site key.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = join(root, 'apps/mobile/src');

const loginSource = readFileSync(join(srcDir, 'app/login.tsx'), 'utf8');
const storeSource = readFileSync(join(srcDir, 'store/auth-store.ts'), 'utf8');
const captchaSource = readFileSync(join(srcDir, 'lib/captcha.ts'), 'utf8');
const gateSource = readFileSync(join(srcDir, 'components/captcha-gate.tsx'), 'utf8');
const envExample = readFileSync(join(srcDir, '../.env.example'), 'utf8');

const problems = [];

// --- 1. All three OTP paths carry the token ---------------------------------
// Function-scoped matches, so `onSendCode(` and `onResendCode(` are NOT counted
// as `sendCode(`. The lazy version of this check passed while counting a call
// that did not exist, which is worse than having no check at all.
if (!/verifyCode\(phone, code\.trim\(\), captchaToken \?\? undefined\)/.test(loginSource)) {
  problems.push('login.tsx does not pass a captcha token to verifyCode');
}

const sendCalls = [...loginSource.matchAll(/(?<![a-zA-Z])sendCode\(/g)].length;
const sendCallsWithToken = [
  ...loginSource.matchAll(/sendCode\([^;]*?, captchaToken \?\? undefined\)/g),
].length;
if (sendCalls !== 2 || sendCallsWithToken !== 2) {
  problems.push(
    `login.tsx calls sendCode ${sendCalls} time(s) but passes a token ` +
      `${sendCallsWithToken} time(s); the resend path needs one too`,
  );
}

if (!/signInWithOtp\(\{[\s\S]*?captchaToken/.test(storeSource)) {
  problems.push('auth-store.ts does not forward captchaToken to signInWithOtp');
}
if (!/verifyOtp\(\{[\s\S]*?captchaToken/.test(storeSource)) {
  problems.push('auth-store.ts does not forward captchaToken to verifyOtp');
}

// --- 2. No secret, anywhere, and nothing named like one ----------------------
const namedSources = [
  ['login.tsx', loginSource],
  ['auth-store.ts', storeSource],
  ['captcha.ts', captchaSource],
  ['captcha-gate.tsx', gateSource],
];
for (const [name, source] of namedSources) {
  if (/captcha_?secret|CAPTCHA_SECRET|turnstile_?secret/i.test(source)) {
    problems.push(`${name} mentions a captcha SECRET; it must never be in the app`);
  }
}
for (const name of [...captchaSource.matchAll(/(EXPO_PUBLIC_[A-Z0-9_]+)/g)].map((m) => m[1])) {
  if (/secret|private/i.test(name)) {
    problems.push(`suspicious public variable name: ${name}`);
  }
}

// --- 3. The key comes from the environment -----------------------------------
if (/EXPO_PUBLIC_CAPTCHA_SITEKEY\s*[:=]\s*['"][^'"]+['"]/.test(captchaSource)) {
  problems.push('captcha.ts hard-codes a site key; it must come from process.env');
}
// A real Turnstile site key is 20+ hex characters. Anything that looks like one
// is a key somebody pasted in.
if (/\b0x[0-9a-fA-F]{24,}\b/.test(captchaSource)) {
  problems.push('captcha.ts contains what looks like a literal Turnstile key');
}
if (!envExample.includes('EXPO_PUBLIC_CAPTCHA_SITEKEY')) {
  problems.push('.env.example does not document EXPO_PUBLIC_CAPTCHA_SITEKEY');
}

// --- 4. A stale token is refused, not sent -----------------------------------
if (!/export function captchaTokenIsFresh/.test(captchaSource)) {
  problems.push('captcha.ts has no freshness rule');
}
if (!/now - held\.issuedAt < CAPTCHA_TOKEN_TTL_MS/.test(captchaSource)) {
  problems.push('captcha.ts does not compare the token age to the TTL');
}
if (!/if \(!captchaTokenIsFresh\(held, now\)\) return null;/.test(captchaSource)) {
  problems.push('captchaOptions can hand back a stale token');
}
if (!/single-use/.test(captchaSource + readFileSync(join(srcDir, 'hooks/use-captcha-token.ts'), 'utf8'))) {
  problems.push('nobody documents that a token is single-use; the rule is why one is spent per attempt');
}

// --- 5. Both locales have every message -------------------------------------
function flatten(obj, prefix = '', out = {}) {
  for (const [key, value] of Object.entries(obj)) {
    const full = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object' && !Array.isArray(value)) flatten(value, full, out);
    else out[full] = value;
  }
  return out;
}
const en = flatten(JSON.parse(readFileSync(join(srcDir, 'i18n/locales/en.json'), 'utf8')));
const kn = flatten(JSON.parse(readFileSync(join(srcDir, 'i18n/locales/kn.json'), 'utf8')));

for (const suffix of ['notReady', 'stale', 'failed']) {
  const key = `auth.captcha.${suffix}`;
  if (en[key] === undefined) problems.push(`no en.json key for ${key}`);
  if (kn[key] === undefined) problems.push(`no kn.json key for ${key}`);
}
for (const [lang, values] of [
  ['en', en],
  ['kn', kn],
]) {
  if (!Object.keys(values).some((key) => key.startsWith('auth.captcha.'))) {
    problems.push(`${lang}.json has no auth.captcha.* keys at all`);
  }
}

// --- 6. The widget is only mounted when the gate is on ------------------------
if (!/if \(!isCaptchaEnabled\(\)\) return null;/.test(gateSource)) {
  problems.push('captcha-gate.tsx renders the widget even when no site key is set');
}
if (!/controlsRef/.test(gateSource)) {
  problems.push('captcha-gate.tsx gives the screen no way to spend the token');
}

// --- Report -------------------------------------------------------------------
if (problems.length > 0) {
  console.error(`captcha check FAILED (${problems.length} problem${problems.length === 1 ? '' : 's'}):`);
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}

console.log(
  'captcha OK — token forwarded on every OTP path, no secret in the app, ' +
    'key from the environment, stale tokens refused, both locales complete.',
);
