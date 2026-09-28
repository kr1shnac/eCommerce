#!/usr/bin/env node
/**
 * i18n guard (AGENTS.md rule 9.5 / ROADMAP §10).
 *
 * Fails the build if:
 *   1. en.json and kn.json do not have exactly the same key set;
 *   2. a key used as a literal in `t('...')` does not exist;
 *   3. a dynamic key family (`t(`orders.status.${x}`)`) is missing one of the
 *      values the enums actually allow — this is what shipped the raw text
 *      `orders.status.confirmed` to a real customer once;
 *   4. a Kannada value is still just the English text;
 *   5. a placeholder is not single-brace word form (`{count}`), which is what
 *      let `"more item{count,s}"` and `{{percent}}` reach customers verbatim.
 *
 * A `t('x')` literal also counts as present when it is plural-aware, i.e.
 * `x_one` and `x_other` both exist.
 *
 * Run directly (`node scripts/check-i18n.mjs`) or through `npm run check:i18n`.
 * It is wired into `npm run lint`, so it runs with every gate.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = join(root, 'apps/mobile/src');
const en = JSON.parse(readFileSync(join(srcDir, 'i18n/locales/en.json'), 'utf8'));
const kn = JSON.parse(readFileSync(join(srcDir, 'i18n/locales/kn.json'), 'utf8'));

const problems = [];

// --- 1. Flatten and compare key sets -----------------------------------------
function flatten(obj, prefix = '', out = {}) {
  for (const [key, value] of Object.entries(obj)) {
    const full = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object' && !Array.isArray(value)) flatten(value, full, out);
    else out[full] = value;
  }
  return out;
}

const flatEn = flatten(en);
const flatKn = flatten(kn);
const enKeys = new Set(Object.keys(flatEn));
const knKeys = new Set(Object.keys(flatKn));

for (const key of enKeys) if (!knKeys.has(key)) problems.push(`missing in kn.json: ${key}`);
for (const key of knKeys) if (!enKeys.has(key)) problems.push(`missing in en.json: ${key}`);

// --- 4. Untranslated Kannada --------------------------------------------------
// Strip placeholders and punctuation first, so "{name}" or "₹1,234" is not
// mistaken for untranslated English.
const strip = (text) =>
  text
    .replace(/\{\{?[^}]*\}?\}/g, '')
    .replace(/[\s\d₹,.%:;/+()\-–—·…|]/g, '');

// Values that are deliberately identical in both languages.
//   - address.areaName: filled from the address, not translated.
//   - privacy.gstinLabel: "GSTIN" is a statutory acronym with no Kannada form;
//     a shop, an accountant and a GST portal all say GSTIN. Transliterating it
//     would make it harder, not easier, to match against a real document.
const SAME_IS_FINE = new Set(['address.areaName', 'privacy.gstinLabel']);

for (const key of enKeys) {
  if (!knKeys.has(key) || SAME_IS_FINE.has(key)) continue;
  const a = flatEn[key];
  const b = flatKn[key];
  if (typeof a === 'string' && typeof b === 'string' && a === b && /[A-Za-z]/.test(strip(a))) {
    problems.push(`kn.json is not translated (identical to English): ${key} = ${JSON.stringify(a)}`);
  }
}

// --- 2 & 3. Every key used in the code ---------------------------------------
function walk(dir) {
  const files = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) files.push(...walk(full));
    else if (/\.(ts|tsx)$/.test(entry)) files.push(full);
  }
  return files;
}

// The enum members a dynamic key family must cover, read from the source of
// truth (the TypeScript unions), so this cannot drift from the database.
const databaseTypes = readFileSync(join(srcDir, 'types/database.ts'), 'utf8');
function unionMembers(typeName) {
  const match = databaseTypes.match(new RegExp(`export type ${typeName}\\s*=([\\s\\S]*?);`));
  if (!match) return null;
  return [...match[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

const loginSource = readFileSync(join(srcDir, 'app/login.tsx'), 'utf8');
const authMatch = loginSource.match(/type AuthErrorKey\s*=\s*([^;]+);/);
const authErrorKeys = authMatch ? [...authMatch[1].matchAll(/'([^']+)'/g)].map((m) => m[1]) : [];

const dynamicRequirements = {
  'orders.status.': unionMembers('OrderStatus') ?? [],
  'order.pay.': unionMembers('PaymentMethod') ?? [],
  'order.payStatus.': unionMembers('PaymentStatus') ?? [],
  'auth.error.': authErrorKeys,
  'checkout.error.': [...(unionMembers('PlaceOrderError') ?? []), 'unknown'],
};

const literalRe = /\bt\(\s*(?:`([^`]*)`|'([^']*)'|"([^"]*)")/g;
const usedLiterals = new Set();
const dynamicPrefixes = new Set();

for (const file of walk(srcDir)) {
  const source = readFileSync(file, 'utf8');
  for (const match of source.matchAll(literalRe)) {
    const value = match[1] ?? match[2] ?? match[3] ?? '';
    if (value.includes('${')) {
      dynamicPrefixes.add(value.split('${')[0]);
    } else {
      usedLiterals.add(value);
    }
  }
}

for (const key of usedLiterals) {
  if (!enKeys.has(key) && !(enKeys.has(`${key}_one`) && enKeys.has(`${key}_other`))) {
    problems.push(`used in code but not in en.json: ${key}`);
  }
}

for (const prefix of dynamicPrefixes) {
  const required = dynamicRequirements[prefix];
  if (required) {
    for (const suffix of required) {
      if (!enKeys.has(`${prefix}${suffix}`)) {
        problems.push(`dynamic family "${prefix}" is missing "${prefix}${suffix}"`);
      }
    }
  } else if (![...enKeys].some((key) => key.startsWith(prefix))) {
    problems.push(`dynamic family "${prefix}" has no keys at all in en.json`);
  }
}

// --- 5. Placeholder style -----------------------------------------------------
// Placeholders are single-brace and word-only: "{count} items". i18next's own
// default is double-brace ("{{count}}"), and a mangled token such as
// "{count,s}" is not interpolated at all — both would be shown to a real
// customer exactly as written, which is how these two bugs got in.
const PLACEHOLDER = /\{[a-zA-Z_][a-zA-Z0-9_]*\}/g;

for (const [lang, flat] of [
  ['en', flatEn],
  ['kn', flatKn],
]) {
  for (const [key, value] of Object.entries(flat)) {
    if (typeof value !== 'string') continue;
    if (/[{}]/.test(value.replace(PLACEHOLDER, ''))) {
      problems.push(
        `bad placeholder in ${lang}.json: ${key} = ${JSON.stringify(value)} (placeholders must be {word})`,
      );
    }
  }
}

// --- Report -------------------------------------------------------------------
if (problems.length > 0) {
  console.error(`i18n check FAILED (${problems.length} problem${problems.length === 1 ? '' : 's'}):`);
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}

console.log(
  `i18n OK — ${enKeys.size} keys in both languages, ${usedLiterals.size} used literals, ` +
    `${dynamicPrefixes.size} dynamic families.`,
);
