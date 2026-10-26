#!/usr/bin/env node
/**
 * check-location.mjs — exactly one module may touch the location package, and
 * the app may never ask for background location.
 *
 * Run:  npm run check:location
 *
 * WHY THIS EXISTS
 *
 * Two promises are made here that nobody can catch by looking at the app.
 *
 * 1. **The Node prerender must not crash.** `app.json` declares
 *    `"web": { "output": "static" }`, so `expo start` builds the app under Node,
 *    where there is no `window` and no native side. AsyncStorage already broke
 *    exactly this way once (`ReferenceError: window is not defined`, dev server
 *    exit code 7) — see `src/lib/storage.ts` and `check-storage.mjs`. A second,
 *    visible import of `expo-location` would reintroduce it, and the person who
 *    adds it would have no reason to suspect.
 *
 * 2. **A rider is never tracked outside a delivery.** That promise is made on a
 *    consent screen, in Kannada, to an employee. The *runtime* half of it is
 *    `shouldRecordPosition()` (tested by `check:tracking`); the *configuration*
 *    half is `app.json`, and it is the half that a copy-pasted setup snippet
 *    silently widens. An `ACCESS_BACKGROUND_LOCATION` that nobody meant to ship
 *    would be visible to Google Play, to iOS review, and to the rider — but not
 *    to us. So it is asserted here.
 *
 * WHAT IT PROVES
 *
 *   1. Only `src/lib/location.ts` mentions `expo-location` at all.
 *   2. That module loads it dynamically, inside a function — never at module
 *      scope, which is what would run during the prerender.
 *   3. The guard is `typeof window`, the runtime test, not `__DEV__`.
 *   4. Under plain Node — which is the prerender's runtime — every entry point
 *      degrades to "unavailable" instead of throwing. This is the crash the file
 *      exists to prevent, exercised directly.
 *   5. `app.json` asks for foreground location only: no Always permission
 *      strings on iOS, background location blocked on Android, no Android
 *      location foreground service.
 *
 * What this does NOT prove: that a real phone grants permission and delivers
 * fixes. Only a device can (`PRODUCTION.md` C4).
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(root, 'apps/mobile/src');
const LOCATION_MODULE = join(SRC, 'lib/location.ts');
const PACKAGE = 'expo-location';

let failures = 0;
function expectTrue(name, ok, detail) {
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok && detail) console.log(`        ${detail}`);
}

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
const source = (file) => readFileSync(file, 'utf8');
/** Comments are stripped before searching: a module may *explain* the rule. */
const stripComments = (text) =>
  text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

console.log('=== 1. only src/lib/location.ts may mention the location package ===');
const mentioners = files.filter(
  (f) => f !== LOCATION_MODULE && stripComments(source(f)).includes(PACKAGE),
);
expectTrue(
  'no module other than lib/location.ts mentions expo-location',
  mentioners.length === 0,
  mentioners.length ? `these do: ${mentioners.map((f) => relative(root, f)).join(', ')}` : '',
);

console.log('\n=== 2. it is loaded dynamically, inside a function ===');
const body = source(LOCATION_MODULE);
const code = body
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1');

expectTrue(
  'no static import of expo-location (a top-level import runs during the prerender)',
  !/^\s*import\s[^;]*from\s*['"]expo-location['"]/m.test(code),
  'found a static `import ... from \'expo-location\'`',
);
expectTrue(
  'the package is reached through a dynamic import()',
  /import\(\s*['"]expo-location['"]\s*\)/.test(code),
  'expected `import(\'expo-location\')`',
);

console.log('\n=== 3. the guard is on the runtime, not the build type ===');
expectTrue('lib/location.ts checks typeof window', code.includes('typeof window'));
expectTrue(
  'lib/location.ts does NOT guard on __DEV__ (a release Node prerender has no window either)',
  !code.includes('__DEV__'),
);
expectTrue(
  'every entry point asks hasLocationRuntime() first',
  (code.match(/hasLocationRuntime\(\)/g) ?? []).length >= 2,
  'expected the runtime test to gate the module loader',
);

console.log('\n=== 4. under Node, every entry point degrades instead of throwing ===');
// This check itself runs under plain Node, which has no `window` — so this is
// exercising exactly the runtime the prerender uses.
const {
  hasLocationRuntime,
  requestForegroundPermission,
  getForegroundPermission,
  watchPosition,
  lastKnownFix,
} = await import(pathToFileURL(LOCATION_MODULE).href);

expectTrue('hasLocationRuntime() is a boolean', typeof hasLocationRuntime() === 'boolean');
expectTrue('under Node, hasLocationRuntime() is false', hasLocationRuntime() === false);
expectTrue(
  'requestForegroundPermission() resolves to "unavailable", not a throw',
  (await requestForegroundPermission()) === 'unavailable',
);
expectTrue(
  'getForegroundPermission() resolves to "unavailable"',
  (await getForegroundPermission()) === 'unavailable',
);
expectTrue(
  'watchPosition() resolves to null, not a throw',
  (await watchPosition(() => {})) === null,
);
expectTrue('lastKnownFix() resolves to null', (await lastKnownFix()) === null);

console.log('\n=== 5. the app asks for foreground location only ===');
const appJson = JSON.parse(source(join(root, 'apps/mobile/app.json')));

const plugin = (appJson.expo.plugins ?? []).find(
  (entry) => (Array.isArray(entry) ? entry[0] : entry) === 'expo-location',
);
expectTrue('the expo-location config plugin is registered', Boolean(plugin));
const options = Array.isArray(plugin) ? (plugin[1] ?? {}) : {};

expectTrue(
  'a foreground permission string is set, so the OS prompt explains itself',
  typeof options.locationWhenInUsePermission === 'string' &&
    options.locationWhenInUsePermission.length > 20,
  `got ${JSON.stringify(options.locationWhenInUsePermission)}`,
);
expectTrue(
  'the iOS "Always" permission strings are removed, not merely unused',
  options.locationAlwaysAndWhenInUsePermission === false &&
    options.locationAlwaysPermission === false,
  'both locationAlwaysAndWhenInUsePermission and locationAlwaysPermission must be false',
);
expectTrue(
  'iOS background location is off (no UIBackgroundModes entry)',
  options.isIosBackgroundLocationEnabled === false,
);
expectTrue(
  'Android background location is off',
  options.isAndroidBackgroundLocationEnabled === false,
);
expectTrue(
  'the Android location foreground service is off',
  options.isAndroidForegroundServiceEnabled === false,
);
const blocked = appJson.expo.android?.blockedPermissions ?? [];
expectTrue(
  'android.blockedPermissions removes ACCESS_BACKGROUND_LOCATION',
  blocked.includes('android.permission.ACCESS_BACKGROUND_LOCATION'),
  `blockedPermissions = ${JSON.stringify(blocked)}`,
);

console.log(
  failures === 0 ? '\nRESULT: all checks passed' : `\nRESULT: ${failures} check(s) failed`,
);
process.exit(failures === 0 ? 0 : 1);
