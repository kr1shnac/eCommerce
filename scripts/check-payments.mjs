#!/usr/bin/env node
/**
 * Payment guard: the gateway's words, and the words the app shows for them.
 *
 * Blinkit and Zepto both treat "every method selectable" as one feature. Our
 * version is three moving parts — the database decides whether the shop can
 * collect, the Edge Functions decide whether the customer paid, and this app
 * turns both answers into sentences. The seam that fails silently is the error
 * CODE: a gateway answers `settle_refused`, the app looks up
 * `pay.error.settle_refused`, and if that key is missing (or missing only in
 * Kannada) the customer is shown the literal string `pay.error.settle_refused`
 * instead of an explanation. Nothing in typecheck, lint or the database tests
 * can see that.
 *
 * So this script reads the three sources directly and refuses to pass unless
 * every code has a sentence in both languages:
 *
 *   1. every `error: '...'` literal answered by `supabase/functions/`;
 *   2. every code in `ONLINE_PAYMENT_ERRORS` (the app's own answers: the sheet
 *      was dismissed, there is no signal, the phone has no build);
 *   3. the same, in reverse — no `pay.error.*` key that no code can ever reach,
 *      which is how a typo'd key hides;
 *   4. every `pay.*` placeholder matches between English and Kannada, because
 *      "{amount}" missing from one language prints the brace to a customer;
 *   5. the checkout's money button carries the amount in both languages.
 *
 * Run directly (`node scripts/check-payments.mjs`) or via `npm run lint`.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = join(root, 'apps/mobile/src');
const functionsDir = join(root, 'supabase/functions');
const paymentsSource = join(srcDir, 'lib/payments.ts');

const en = JSON.parse(readFileSync(join(srcDir, 'i18n/locales/en.json'), 'utf8'));
const kn = JSON.parse(readFileSync(join(srcDir, 'i18n/locales/kn.json'), 'utf8'));

const problems = [];

// --- 1. What the gateway answers --------------------------------------------
function walkFiles(dir, extensions) {
  const files = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) files.push(...walkFiles(full, extensions));
    else if (extensions.some((ext) => entry.endsWith(ext))) files.push(full);
  }
  return files;
}

const serverCodes = new Set();
for (const file of walkFiles(functionsDir, ['.ts'])) {
  const source = readFileSync(file, 'utf8');
  // Every `error: 'code'` and `new OnlinePaymentFailed('code')` answer.
  for (const match of source.matchAll(/error:\s*'([a-z_]+)'/g)) serverCodes.add(match[1]);
  for (const match of source.matchAll(/OnlinePaymentFailed\(\s*'([a-z_]+)'/g)) {
    serverCodes.add(match[1]);
  }
}

// --- 2. What the app answers on its own -------------------------------------
const paymentsFile = readFileSync(paymentsSource, 'utf8');
const codesMatch = paymentsFile.match(
  /export const ONLINE_PAYMENT_ERRORS = \[([\s\S]*?)\] as const;/,
);
if (!codesMatch) {
  console.error('payment check FAILED: could not read ONLINE_PAYMENT_ERRORS from payments.ts');
  process.exit(1);
}
const appCodes = new Set([...codesMatch[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]));

// --- 1 & 2: every code has a sentence, in both languages --------------------
for (const code of [...serverCodes, ...appCodes].sort()) {
  const key = `pay.error.${code}`;
  if (en.pay?.error?.[code] === undefined) problems.push(`no en.json key for gateway code ${key}`);
  if (kn.pay?.error?.[code] === undefined) problems.push(`no kn.json key for gateway code ${key}`);
}

// --- 3: the other direction — no unreachable key ----------------------------
const localeCodes = new Set(Object.keys(en.pay?.error ?? {}));
for (const code of localeCodes) {
  if (!serverCodes.has(code) && !appCodes.has(code)) {
    problems.push(`pay.error.${code} is in the locales but no code answers it`);
  }
}
if (localeCodes.size !== Object.keys(kn.pay?.error ?? {}).length) {
  problems.push('en.json and kn.json disagree on how many `pay.error.*` keys exist');
}

// --- 4: placeholders match, language by language ----------------------------
const PLACEHOLDER = /\{[a-zA-Z_][a-zA-Z0-9_]*\}/g;
const placeholders = (text) => [...String(text).matchAll(PLACEHOLDER)].map((m) => m[0]).sort();

function walkGroup(group, prefix, enValue, knValue) {
  if (enValue && typeof enValue === 'object') {
    for (const key of Object.keys(enValue)) {
      walkGroup(group, `${prefix}${key}.`, enValue[key], knValue?.[key]);
    }
    return;
  }
  if (typeof enValue !== 'string' || typeof knValue !== 'string') return;
  const a = placeholders(enValue);
  const b = placeholders(knValue);
  if (a.join() !== b.join()) {
    problems.push(`${prefix.slice(0, -1)} placeholders differ: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`);
  }
}

walkGroup('pay', 'pay.', en.pay, kn.pay);

// --- 5. the money button ----------------------------------------------------
for (const [lang, values] of [
  ['en', en],
  ['kn', kn],
]) {
  const key = values.checkout?.payAmount;
  if (typeof key !== 'string') {
    problems.push(`${lang}.json has no checkout.payAmount`);
    continue;
  }
  if (!placeholders(key).includes('{amount}')) {
    problems.push(`${lang}.json checkout.payAmount does not name the amount: ${JSON.stringify(key)}`);
  }
}

// --- Report -----------------------------------------------------------------
if (problems.length > 0) {
  console.error(`payment check FAILED (${problems.length} problem${problems.length === 1 ? '' : 's'}):`);
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}

console.log(
  `payments OK — ${serverCodes.size} gateway codes, ${appCodes.size} app codes, ` +
    `${localeCodes.size} sentences in both languages.`,
);
