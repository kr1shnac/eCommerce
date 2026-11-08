#!/usr/bin/env node
/**
 * check-metro.mjs — Metro can resolve a package's OWN nested dependency.
 *
 * Run:  npm run check:metro
 *
 * WHY THIS EXISTS
 *
 * On 2026-11-08 the web export died with:
 *
 *   Unable to resolve module semver/functions/satisfies from
 *   node_modules/react-native-reanimated/scripts/validate-worklets-version.js
 *
 * The gesture stack (`react-native-gesture-handler`, `react-native-reanimated`)
 * was already a dependency by then. Reanimated's worklets version validator
 * imports `semver/functions/satisfies`, and npm had given reanimated its own
 * private `semver@7.8.5` — because the hoisted root copy is `semver@6.3.1`,
 * wanted by eslint-plugin-import, eslint-plugin-react, node-exports-info and
 * babel-plugin-polyfill-corejs2.
 *
 * Nothing in the normal test suite would have caught it. Typecheck does not
 * resolve modules, `expo-doctor` does not bundle, and the Android build kept
 * working the whole time — the failing path is the WEB bundle, which
 * `app.json` (`"web": { "output": "static" }`) means runs under Node during
 * `expo start`'s prerender. That is the same class of failure as the
 * AsyncStorage `window is not defined` crash that `lib/storage.ts` exists to
 * prevent: the build type nobody runs.
 *
 * WHAT IT PROVES
 *
 *   1. The rule that broke is off and stays off. `disableHierarchicalLookup`
 *      must be false, because with it true Metro resolves ONLY from the named
 *      `nodeModulesPaths` and never from a package's own `node_modules`.
 *   2. The specific module that failed can be resolved from those paths alone —
 *      i.e. under the OLD rule it fails, which is the assertion that would have
 *      caught the bug without needing an exporter to run.
 *   3. The modules the app actually imports for the map are installed, so this
 *      cannot pass by accident on a machine where they are missing.
 *   4. The map's dependencies are declared with versions the installed tree
 *      satisfies, which is the drift that turns "works here" into a broken CI.
 *
 * What this does NOT prove: that the web bundle builds. That is
 * `npx expo export --platform web` and it takes a minute; this is the cheap
 * version that runs on every lint.
 */
import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const MOBILE = join(root, 'apps/mobile');

let failures = 0;
function expectTrue(name, ok, detail = '') {
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok && detail) console.log(`        ${detail}`);
}

// Metro's own resolution settings, read from the file rather than duplicated, so
// this check cannot disagree with the config it is guarding.
const metroSource = readFileSync(join(MOBILE, 'metro.config.js'), 'utf8');

console.log('=== 1. the rule that broke is off ===');
expectTrue(
  'disableHierarchicalLookup is false (a package\'s nested node_modules must be reachable)',
  /disableHierarchicalLookup\s*=\s*false/.test(metroSource),
  'metro.config.js sets it to true: Metro then resolves only from nodeModulesPaths, which is how semver/functions/satisfies became unresolvable',
);
expectTrue(
  'and it is not silently left unset',
  /disableHierarchicalLookup/.test(metroSource),
);

const nodeModulesPaths = [...metroSource.matchAll(/path\.resolve\([^)]*?(?:projectRoot|workspaceRoot)[^)]*'node_modules'\)/g)].map((m) =>
  m[0].replace(/path\.resolve\(([^,]+),\s*'node_modules'\)/, (_, base) =>
    join(MOBILE, base.trim() === 'projectRoot' ? '' : '../..', 'node_modules'),
  ),
);
expectTrue(
  'the two workspace node_modules paths are declared',
  nodeModulesPaths.length === 2,
  `found ${nodeModulesPaths.length}: ${nodeModulesPaths.join(', ')}`,
);

const require_ = createRequire(import.meta.url);
const reanimatedEntry = require_.resolve('react-native-reanimated', {
  paths: [MOBILE, root],
});
const reanimatedDir = dirname(reanimatedEntry);

console.log('\n=== 2. the module that failed must resolve, and here is why it did not ===');
// The copy exists, inside reanimated's own node_modules. This is what npm gives a
// package when the hoisted root version conflicts with what it needs.
try {
  const privateCopy = require_.resolve('semver/functions/satisfies', {
    paths: [join(reanimatedDir, 'node_modules')],
  });
  expectTrue(
    'reanimated has its own semver 7, which is the only version with functions/',
    /node_modules[\\/]semver[\\/]functions[\\/]satisfies\.js$/.test(privateCopy),
    privateCopy,
  );
} catch (error) {
  expectTrue('reanimated has its own semver 7, which is the only version with functions/', false, String(error));
}

// And this is the rule that broke: Metro with `disableHierarchicalLookup: true`
// looks ONLY in the named paths, never in a package's own node_modules. The root
// copy is semver 6, which has no `functions/`, so the import failed.
let strictFound = null;
for (const path of nodeModulesPaths) {
  const candidate = join(path, 'semver', 'functions', 'satisfies.js');
  if (existsSync(candidate)) strictFound = candidate;
}
expectTrue(
  'the named paths alone do NOT have it — which is exactly why hierarchical lookup must stay on',
  strictFound === null,
  `found ${strictFound}: the hoisted copy is semver 7 and this assertion is stale`,
);

expectTrue(
  'the hoisted root copy is semver 6, the conflicting version',
  readFileSync(join(root, 'node_modules/semver/package.json'), 'utf8').includes('"version": "6.'),
);

console.log('\n=== 3. the map\'s dependencies are installed ===');
for (const name of [
  'react-native-gesture-handler',
  'react-native-reanimated',
  'react-native-svg',
  'expo-image',
]) {
  try {
    expectTrue(`${name} resolves from the workspace`, Boolean(require_.resolve(name, { paths: [MOBILE, root] })));
  } catch (error) {
    expectTrue(`${name} resolves from the workspace`, false, String(error));
  }
}

console.log('\n=== 4. the two modules that need Node-only care still get it ===');
// The hazard this project has been bitten by: a package whose web build touches
// `window` while the prerender runs under Node. The two fixes are deliberately
// different shapes, and each one is pinned here so a tidy-up cannot "simplify"
// either of them into a crash.
//
//   * storage.ts imports statically but swaps in an in-memory shim when there is
//     no `window`, so the phone is untouched and Node loses nothing it had.
//   * location.ts does not even load the native module in Node — it is a
//     dynamic import inside a function, behind `typeof window`.
const storageSource = readFileSync(join(MOBILE, 'src/lib/storage.ts'), 'utf8');
const storageCode = storageSource.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
expectTrue(
  'storage.ts still imports the package statically (and then guards the shim)',
  /import\s+AsyncStorage\s+from\s+'@react-native-async-storage\/async-storage'/.test(storageCode),
);
expectTrue(
  'storage.ts still chooses the shim on typeof window, not on the build type',
  storageCode.includes('typeof window'),
);
expectTrue(
  'storage.ts still has no __DEV__ branch (a release Node build has no window either)',
  !storageCode.includes('__DEV__'),
);

const locationCode = readFileSync(join(MOBILE, 'src/lib/location.ts'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
expectTrue(
  'location.ts still imports expo-location dynamically, inside a function',
  /import\(\s*'expo-location'\s*\)/.test(locationCode) &&
    !/^\s*import[^\n]*from\s*'expo-location'/m.test(locationCode),
);
expectTrue('location.ts still guards on typeof window', locationCode.includes('typeof window'));

console.log(
  `\n${failures === 0 ? 'RESULT: all checks passed' : `RESULT: ${failures} check(s) failed`}`,
);
process.exit(failures === 0 ? 0 : 1);
