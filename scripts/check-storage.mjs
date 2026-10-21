#!/usr/bin/env node
/**
 * check-storage.mjs — nothing in the app may import AsyncStorage directly.
 *
 * Run:  npm run check:storage
 *
 * WHY THIS EXISTS (a bug that broke `npm run mobile`, not a style rule)
 * -------------------------------------------------------------------
 * `app.json` declares `"web": { "output": "static" }`, so `expo start` PRERENDERS
 * the app under Node to produce the web build. Node has no `window`.
 *
 * `@react-native-async-storage/async-storage` ships a web build whose methods
 * call `window.localStorage` directly. So when `src/lib/supabase.ts` passed the
 * package straight to `createClient({ auth: { storage: AsyncStorage } })`, the
 * Node prerender threw:
 *
 *     ReferenceError: window is not defined
 *       at Object.getItem (AsyncStorage.js)
 *       at SupabaseAuthClient.__loadSession
 *
 * and the dev server exited with code 7 before a phone could ever connect. The
 * phone app was never broken; only `expo start`, because it insists on building
 * a target this shop does not ship.
 *
 * THE RULE THIS ENFORCES: exactly ONE module may touch the storage package —
 * `src/lib/storage.ts` — because it is the module that decides, by runtime
 * rather than by build type, whether a device store exists. Every other module
 * asks it. If a second import appears, the crash above is one `expo start` away
 * again, and the person who adds it will have no reason to suspect it.
 *
 * WHAT IT PROVES
 *
 *   1. No file under `apps/mobile/src/` imports the storage package except
 *      `src/lib/storage.ts` itself.
 *   2. The five modules that DO need storage use `deviceStorage`, not the
 *      package — so a future edit that keeps the import count right but drops
 *      the guard still fails.
 *   3. `src/lib/storage.ts` still guards on `typeof window`, rather than on
 *      `__DEV__`: the failure is about the runtime, and a release web build in
 *      Node would hit exactly the same crash.
 *   4. The guard's fallback has the same shape as the real thing
 *      (getItem/setItem/removeItem, all returning promises), because a
 *      shape mismatch would break sign-in in a way this file could not see.
 *
 * What this does NOT prove: that a phone actually persists anything. That is
 * `check:session` (the session survives a restart) and, ultimately, a device.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(root, 'apps/mobile/src');
const STORAGE_MODULE = join(SRC, 'lib/storage.ts');
const PACKAGE = '@react-native-async-storage/async-storage';

let failures = 0;
function expectTrue(name, ok, detail) {
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok && detail) console.log(`        ${detail}`);
}

/** Every .ts/.tsx file under src/, so a new file is covered automatically. */
function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

const files = walk(SRC);

console.log('=== 1. only src/lib/storage.ts may import the storage package ===');
const directImporters = files.filter(
  (f) => f !== STORAGE_MODULE && readFileSync(f, 'utf8').includes(`from '${PACKAGE}'`),
);
expectTrue(
  'no module other than lib/storage.ts imports AsyncStorage',
  directImporters.length === 0,
  directImporters.length
    ? `these do: ${directImporters.map((f) => relative(root, f)).join(', ')}`
    : '',
);

console.log('\n=== 2. the modules that need storage go through deviceStorage ===');
// The exact set is not the point; that each one is guarded is. If a module stops
// needing storage, drop it here — the test is "needs storage ⇒ uses the guard".
const CONSUMERS = [
  'lib/supabase.ts',
  'lib/query-persistence.ts',
  'store/theme-store.ts',
  'store/cart-store.ts',
  'i18n/index.ts',
];
for (const rel of CONSUMERS) {
  const full = join(SRC, rel);
  let body = '';
  try {
    body = readFileSync(full, 'utf8');
  } catch {
    expectTrue(`${rel} exists`, false, 'file is missing');
    continue;
  }
  expectTrue(`${rel} uses deviceStorage`, body.includes('deviceStorage'));
}

console.log('\n=== 3. the guard is on the runtime, not the build type ===');
const storageSrc = readFileSync(STORAGE_MODULE, 'utf8');
// Strip comments first: the file *explains* why it avoids `__DEV__`, and that
// sentence must not read as a use of it. Only real code counts.
const storageCode = storageSrc
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
expectTrue(
  'lib/storage.ts checks typeof window',
  storageCode.includes('typeof window'),
);
expectTrue(
  'lib/storage.ts does NOT guard on __DEV__ in code (a release Node prerender crashes too)',
  !storageCode.includes('__DEV__'),
);

console.log('\n=== 4. the Node fallback has the same shape as the real store ===');
const { deviceStorage, hasDeviceStorage } = await import(
  pathToFileURL(STORAGE_MODULE).href
);
expectTrue('hasDeviceStorage() is a boolean', typeof hasDeviceStorage() === 'boolean');
// This check runs under plain Node, which has no window — so it is exercising the
// fallback path, which is exactly the path the crash came from.
expectTrue('under Node, hasDeviceStorage() is false', hasDeviceStorage() === false);
for (const method of ['getItem', 'setItem', 'removeItem']) {
  expectTrue(
    `fallback has ${method}()`,
    typeof deviceStorage[method] === 'function',
  );
}
const missing = await deviceStorage.getItem('kunigal.nothing.here');
expectTrue('getItem of a missing key returns null, not undefined', missing === null);
await deviceStorage.setItem('kunigal.probe', 'ok');
const readBack = await deviceStorage.getItem('kunigal.probe');
expectTrue('setItem then getItem round-trips', readBack === 'ok');
await deviceStorage.removeItem('kunigal.probe');
expectTrue('removeItem clears it', (await deviceStorage.getItem('kunigal.probe')) === null);
// A value written as a number must come back a string, because that is what the
// real AsyncStorage does and auth-js compares against strings.
await deviceStorage.setItem('kunigal.num', 42);
expectTrue('a number is stored as a string', (await deviceStorage.getItem('kunigal.num')) === '42');
await deviceStorage.removeItem('kunigal.num');

console.log(
  failures === 0
    ? '\nRESULT: all checks passed'
    : `\nRESULT: ${failures} check(s) failed`,
);
process.exit(failures === 0 ? 0 : 1);
