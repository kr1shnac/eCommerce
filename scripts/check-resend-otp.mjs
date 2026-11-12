/**
 * Batch 6 proof: the resend door on the login screen.
 *
 * `signInWithOtp` has always been callable again, but the screen never offered
 * it — a customer whose SMS never arrived had to back out and retype their
 * number. This check pins the things that make the resend a *door* rather
 * than a trap:
 *
 *   1. the button exists on the code step, and only there;
 *   2. it is disabled while a countdown is running, and re-enabled at zero;
 *   3. the label says how long, in seconds, so the wait is legible;
 *   4. both keys exist in both languages, and the placeholder is single-brace;
 *   5. NEW: the cooldown is never SHORTER than the server's OTP request
 *      frequency, so the button can never appear before a tap would be
 *      accepted. Supabase's default is 60s; a 30s client countdown put a
 *      tappable button on screen 30 seconds early and the customer was told
 *      "too many attempts" for having waited exactly as long as they were told.
 *
 * It reads the source rather than a rendered tree (the same approach
 * `check:auth-doors` and `check:unit-price` use), because what must not regress
 * is the *wiring*, not a pixel.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const screenPath = join(root, 'apps/mobile/src/app/login.tsx');
const enPath = join(root, 'apps/mobile/src/i18n/locales/en.json');
const knPath = join(root, 'apps/mobile/src/i18n/locales/kn.json');

const screen = readFileSync(screenPath, 'utf8');
const en = JSON.parse(readFileSync(enPath, 'utf8'));
const kn = JSON.parse(readFileSync(knPath, 'utf8'));

let failures = 0;
function check(label, ok, detail) {
  if (!ok) {
    failures += 1;
    console.log(`FAIL ${label}`);
    if (detail) console.log(`     ${detail}`);
    return;
  }
  console.log(`PASS ${label}`);
}

const has = (re, subject) => re.test(subject);

console.log('=== 1. the resend door exists, and only where it is wanted ===');
check('the screen declares a resend cooldown constant', has(/RESEND_SECONDS\s*=\s*\d+/, screen));
check(
  'the resend handler calls the same send the phone step uses',
  // Both paths must go through the same send, token and all: Supabase demands a
  // token on a resend exactly as on the first send.
  has(/onResendCode[\s\S]{0,900}?sendCode\(phone, captchaToken/, screen),
);
check(
  'sending a code starts the cooldown',
  has(
    /await sendCode\(normalised, captchaToken \?\? undefined\);[\s\S]{0,400}?setResendIn\(RESEND_SECONDS\)/,
    screen,
  ),
);
check(
  'the button only renders on the code step',
  has(/step === 'code' \? \(\s*<Pressable[\s\S]{0,400}?onResendCode/, screen),
);

console.log('\n=== 2. the cooldown disables the button, and zero releases it ===');
check(
  'the button is disabled while the countdown runs',
  has(/disabled=\{busy \|\| resendIn > 0\}/, screen),
);
check(
  'the handler itself refuses while counting down (a second tap cannot slip past)',
  has(/if \(busy \|\| !phone \|\| resendIn > 0\) return;/, screen),
);
check(
  'resetting the cooldown clears the error so the old one is not shown twice',
  has(/onResendCode[\s\S]{0,300}?setErrorKey\(null\)/, screen),
);

console.log('\n=== 3. the wait is legible ===');
check('the label reads seconds while counting down', has(/t\('auth\.resendIn'/, screen));
check('the label falls back to the plain action when the countdown is done', has(/t\('auth\.resend'\)/, screen));
check(
  'an interval drives the countdown and is cleared on the way out',
  has(/setInterval\([\s\S]{0,220}?clearInterval\(timer\)/, screen),
);

console.log('\n=== 4. the countdown never beats the server ===');
// Supabase Auth's default OTP request frequency is 60s per number. A shorter
// client countdown offers a button the server will refuse.
const cooldown = Number((screen.match(/RESEND_SECONDS\s*=\s*(\d+)/) || [])[1]);
const SERVER_FLOOR_SECONDS = 60;
check(
  'the cooldown is at least the server OTP frequency (' + SERVER_FLOOR_SECONDS + 's)',
  Number.isFinite(cooldown) && cooldown >= SERVER_FLOOR_SECONDS,
  'RESEND_SECONDS is ' + cooldown,
);

console.log('\n=== 5. both languages, single-brace placeholder ===');
const enAuth = en.auth ?? {};
const knAuth = kn.auth ?? {};
for (const key of ['resend', 'resendIn']) {
  check(`${key} exists in English`, typeof enAuth[key] === 'string' && enAuth[key].length > 0);
  check(`${key} exists in Kannada`, typeof knAuth[key] === 'string' && knAuth[key].length > 0);
}
check(
  'the countdown placeholder is single-brace and word-only',
  /\{seconds\}/.test(String(enAuth.resendIn ?? '')) && !/\{\{|\}\}/.test(String(enAuth.resendIn ?? '')),
  String(enAuth.resendIn ?? ''),
);

console.log();
if (failures > 0) {
  console.log(`RESULT: ${failures} check(s) failed`);
  process.exit(1);
}
console.log('RESULT: all checks passed');
