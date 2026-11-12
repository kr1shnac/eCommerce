#!/usr/bin/env node
/**
 * Start the Expo dev server with a heap big enough for Metro.
 *
 * WHY THIS EXISTS
 *
 * On 2026-11-11 `expo start` died with `FATAL ERROR: Ineffective mark-compacts
 * near heap limit — JavaScript heap out of memory` on a machine with 7.7 GB of
 * RAM. Nothing was wrong with the app: Node caps V8's old-space at ~2 GB by
 * default (the log showed a 2043 MB ceiling) and Metro's dev server — module
 * graph, file watching, source maps, and on some runs the **web** bundle — needs
 * more than that. `expo export --platform web` had been passing all along,
 * because a one-shot export is far lighter than a long-lived dev server; that
 * asymmetry is exactly why this was invisible to the CI build job.
 *
 * The dev server is where the memory goes, so the dev server is where the heap
 * is raised. A wrapper rather than an inline env var because
 * `NODE_OPTIONS=… expo start` is not portable syntax: cmd.exe on Windows
 * rejects it, and the project builds on Windows, macOS and Linux. Spawning a
 * fresh Node with the flag works everywhere and needs no dependency.
 *
 * WHAT IT DOES NOT DO
 *
 *   * It does not change how the app bundles, or add a package.
 *   * It does not touch `NODE_OPTIONS` for the whole shell — only this child.
 *   * It does not pick a platform. Expo Go on Android needs no Android SDK and
 *     no `--android` flag (that flag makes Expo look for adb, which fails with
 *     "Failed to resolve the Android SDK path" on a machine that has Expo Go and
 *     no SDK — a different, misleading error).
 *
 * Override the ceiling with `KUNIGAL_MOBILE_HEAP_MB` if a machine needs more or
 * less. It is deliberately below the machine's RAM: the dev server, the OS and
 * the phone's connection all need room at once.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';

const appDir = resolve(import.meta.dirname, '..', 'apps', 'mobile');

// Find Expo's CLI wherever the workspace hoisted it, rather than assuming.
// `expo` exposes its entry through its `bin` field, and there is no `exports`
// map, so `require.resolve('expo/cli')` does not work — resolving the package
// root and joining its bin path does.
function findExpoCli() {
  const require = createRequire(join(appDir, 'package.json'));
  const roots = [
    () => dirname(require.resolve('expo/package.json', { paths: [appDir, resolve(appDir, '..', '..')] })),
    () => resolve(appDir, 'node_modules', 'expo'),
    () => resolve(appDir, '..', '..', 'node_modules', 'expo'),
  ];
  for (const root of roots) {
    try {
      const pkg = root();
      const cli = join(pkg, 'bin', 'cli');
      if (existsSync(cli)) return cli;
    } catch {
      // try the next location
    }
  }
  console.error('[start-mobile] could not find the expo CLI.');
  console.error('              Run `npm install` from the repo root, then retry.');
  process.exit(1);
}

const cli = findExpoCli();

// 6 GB: comfortably above the ~2 GB that failed, comfortably below 7.7 GB of
// RAM once the OS and Metro's workers are accounted for.
const heapMb = Number(process.env.KUNIGAL_MOBILE_HEAP_MB ?? 6144);
if (!Number.isFinite(heapMb) || heapMb < 1024) {
  console.error(`[start-mobile] KUNIGAL_MOBILE_HEAP_MB must be at least 1024, got "${process.env.KUNIGAL_MOBILE_HEAP_MB}"`);
  process.exit(1);
}

// Everything the caller passed after `--` reaches Expo untouched, so
// `npm run mobile -- -c` still clears the Metro cache.
const expoArgs = ['start', ...process.argv.slice(2)];

console.log(`[start-mobile] expo ${expoArgs.join(' ')}  ·  heap ${heapMb} MB  ·  ${appDir}`);

const child = spawn(
  process.execPath,
  [`--max-old-space-size=${heapMb}`, cli, ...expoArgs],
  { cwd: appDir, stdio: 'inherit', env: process.env }
);

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 0);
});
