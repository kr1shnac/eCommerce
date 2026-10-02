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
config.resolver.disableHierarchicalLookup = true;

module.exports = config;