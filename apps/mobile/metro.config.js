// Expo + npm workspaces monorepo setup.
// Without this, Metro does not look inside the repo root's node_modules and
// dependency resolution breaks when packages are hoisted to the workspace root.
// Docs: https://docs.expo.dev/guides/monorepos/

const path = require('path');

const { getDefaultConfig } = require('expo/metro-config');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

// OFF, and this is the fix for a real bug found on 2026-11-08.
//
// This line used to be `true`, with a comment arguing that Expo's monorepo guide
// asks for it and that `expo-doctor`'s warning was a false positive. The
// argument was wrong in a way that cost a day: with hierarchical lookup OFF,
// Metro resolves ONLY from the two `nodeModulesPaths` above and never from a
// package's own nested `node_modules`.
//
// npm puts a private copy of a dependency in `<pkg>/node_modules/` exactly when
// the hoisted root version conflicts — and that is what it does here. The root
// has `semver@6.3.1` (eslint-plugin-import, eslint-plugin-react,
// node-exports-info and babel-plugin-polyfill-corejs2 all want ^6), so npm gave
// `react-native-reanimated` its own `semver@7.8.5`. Reanimated's
// `scripts/validate-worklets-version.js` imports `semver/functions/satisfies`,
// which only exists in semver 7. With hierarchical lookup off, Metro looked at
// the root's semver 6, found no `functions/` directory, and **the web build
// failed outright**: `Unable to resolve module semver/functions/satisfies`.
//
// Why nobody had hit this before: the failing module is reached by the **web**
// bundle's graph, and nobody had run `expo export --platform web` since the
// gesture stack went in. `react-native-gesture-handler` and `react-native-reanimated`
// were both already in `package.json` for releases; the Android export — the thing
// the old comment called "the proof it works" — does not resolve this path, so it
// kept passing while web could not build at all. True, and useless.
//
// Hierarchical lookup is Node's own rule and the safe default: Metro now finds a
// package's private copy as well as the hoisted one. The cost is that a package
// resolving two different versions can load twice — a bundle-size concern, not a
// correctness one, and a far better trade than a build that cannot resolve a
// module at all.
//
// `scripts/check-metro.mjs` now fails the lint chain if this is flipped back on,
// and proves the specific case: `semver/functions/satisfies` must resolve from
// the two configured paths alone, which is precisely the rule that was broken.
config.resolver.disableHierarchicalLookup = false;

module.exports = config;
