#!/usr/bin/env node
/**
 * Release-build env guard (the demo-password and reviewer-credential rule).
 *
 * THE RISK THIS GUARDS
 * --------------------
 * `EXPO_PUBLIC_*` values are inlined into any bundle built while they are set —
 * readable by anyone with the binary, dead code or not. `demo-accounts.ts` keeps
 * the DEMO door behind `__DEV__` and `scripts/check-auth-doors.mjs proves that a
 * release build opens NO door, but neither of those keeps the credential
 * strings out of the file. A release build made with
 * `EXPO_PUBLIC_DEMO_PASSWORD=a-shopper-password` still carries that password,
 * and one made with the REVIEW pair carries the reviewer's, in every binary
 * handed to Google and Apple.
 *
 * The demo addresses were in `apps/mobile/.env` in exactly that state — set,
 * forgotten, and one `eas build --profile production` away from shipping.
 *
 * This fails the build unless:
 *   1. `apps/mobile/.env` — the file whose values are inlined into EVERY
 *      bundle — carries NONE of the six door variables, not even an empty one
 *      on its own line (empty is still a line that documents a door; the
 *      template already documents them, in `.env.example`, where they belong).
 *   2. `apps/mobile/eas.json` sets no door variable to a NON-EMPTY value in any
 *      build profile. Empty strings stay legal there, because that is how the
 *      `review` profile expresses "this door is configured per build, from
 *      `eas env`, not from the repository" — and check-auth-doors already
 *      proves a half-configured review build opens no door.
 *   3. `.env.example` mentions the six variables only in comments — the
 *      template must never carry a value that looks like one.
 *
 * WHY A FAILING LINT INSTEAD OF A CHECK AT BUILD TIME
 * ---------------------------------------------------
 * Because the mistake happens on a Tuesday, before the build. A dev who wants
 * the demo door in Expo Go uncomments the lines, works, re-comments them, and
 * lint refuses to run until they did — the same hour it cannot be missed, not
 * the day of the store submission. The documented development path no longer
 * needs the demo door at all: a Supabase test number (docs/launch/SMS-SETUP.md
 * §Step 1) signs in end to end with no SMS and no cost.
 *
 * What this CANNOT prove, and PRODUCTION.md says so: that the EAS environment
 * used for a build has none of them set. That is on the build's own
 * `eas env list` and it is one command on the day.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const DOOR_KEYS = [
  'EXPO_PUBLIC_DEMO_PASSWORD',
  'EXPO_PUBLIC_DEMO_CUSTOMER_EMAIL',
  'EXPO_PUBLIC_DEMO_DELIVERY_EMAIL',
  'EXPO_PUBLIC_DEMO_ADMIN_EMAIL',
  'EXPO_PUBLIC_REVIEW_EMAIL',
  'EXPO_PUBLIC_REVIEW_PASSWORD',
];

const problems = [];

/** Parse KEY=VALUE lines, skipping blank lines and comments.
 *
 *  The BOM matters: a `.env` edited by PowerShell on Windows arrives with one,
 *  and without this the FIRST variable in the file would not be seen by
 *  anything that matches on the key — including the check below. */
function readText(path) {
  return readFileSync(path, 'utf8').replace(/^\uFEFF/, '');
}

/** Parse KEY=VALUE lines, skipping blank lines and comments. */
function readEnv(path) {
  if (!existsSync(path)) return new Map();
  const map = new Map();
  for (const raw of readText(path).split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) continue;
    const at = line.indexOf('=');
    if (at === -1) continue;
    const key = line.slice(0, at).trim();
    const value = line.slice(at + 1).trim();
    map.set(key, value);
  }
  return map;
}

// --- 1. The file that ships carries no door at all ----------------------------
const envPath = join(root, 'apps/mobile/.env');
if (existsSync(envPath)) {
  const env = readEnv(envPath);
  const set = DOOR_KEYS.filter((key) => env.has(key));
  if (set.length > 0) {
    problems.push(
      `apps/mobile/.env sets ${set.join(', ')}. These are inlined into any ` +
        'bundle built from this folder, password and all. Remove the lines — ' +
        '.env.example keeps the documentation, and the demo door is turned on ' +
        'by hand for an Expo Go session and turned straight back off.',
    );
  }
} else {
  console.log('PASS  apps/mobile/.env does not exist (nothing to leak)');
}

// --- 2. eas.json never carries a door value ----------------------------------
const easPath = join(root, 'apps/mobile/eas.json');
const eas = JSON.parse(readText(easPath));
let easProblem = false;
for (const [profile, config] of Object.entries(eas.build ?? {})) {
  for (const key of DOOR_KEYS) {
    const value = config.env?.[key];
    if (value !== undefined && `${value}`.trim() !== '') {
      easProblem = true;
      problems.push(
        `eas.json build.${profile} sets ${key} to a value. A credential in the ` +
          'repository reaches every build from that profile, including the ' +
          'ones the stores install. Leave it unset here and configure the ' +
          'profile through `eas env` on the machine that needs it.',
      );
    }
  }
}
if (!easProblem) {
  console.log('PASS  eas.json sets no door variable to a value');
}

// --- 3. The template documents the doors in comments only ---------------------
const envExample = readFileSync(join(root, 'apps/mobile/.env.example'), 'utf8');
const uncommented = DOOR_KEYS.filter(
  (key) =>
    envExample
      .split(/\r?\n/)
      .some((line) => line.replace(/^\s+/, '').startsWith(`${key}=`)),
);
if (uncommented.length > 0) {
  problems.push(
    `.env.example sets ${uncommented.join(', ')} outside a comment. The ` +
      'template is committed, so its values reach every clone of the repo.',
  );
} else {
  console.log('PASS  .env.example documents the doors in comments only');
}

// --- Verdict -----------------------------------------------------------------
if (problems.length > 0) {
  console.error(`\nFAIL — ${problems.length} problem(s):\n`);
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}

console.log('\nRESULT: all checks passed');
