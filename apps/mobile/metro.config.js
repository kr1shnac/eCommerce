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
// Deliberate, and `expo-doctor` warns about it — the warning is a false positive
// here. Expo's own monorepo guide asks for exactly this line: with npm workspaces
// hoisting packages to the repo root, `nodeModulesPaths` above already names the
// two places to look, and leaving hierarchical lookup on lets Metro additionally
// walk up from every file, which is how two copies of a package get loaded at
// once. Removing it to quieten the doctor is the change that would actually
// break the build; `npx expo export --platform android` is the proof it works.
config.resolver.disableHierarchicalLookup = true;

module.exports = config;