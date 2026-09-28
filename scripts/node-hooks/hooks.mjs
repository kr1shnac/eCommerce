/**
 * Resolve hooks for the Node-run checks, used only by `npm run check:*`.
 *
 * Metro and TypeScript resolve two things that plain Node cannot:
 *
 *   1. the `@/` path alias (`@/lib/supabase` -> `apps/mobile/src/lib/supabase`);
 *   2. `@react-native-async-storage/async-storage`, whose Babel interop hands the
 *      app the module's `default` export, whereas Node hands over the whole
 *      `{ default, useAsyncStorage }` namespace.
 *
 * This file teaches Node both, for the checks only. Nothing in the app imports
 * it, and it never affects a bundle.
 */
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const MOBILE_SRC = join(root, 'apps/mobile/src');
const STAND_IN = new URL('./async-storage-stand-in.mjs', import.meta.url).href;

/** `@/x` -> `apps/mobile/src/x`, trying the extensions TypeScript allows. */
function resolveAlias(specifier) {
  const base = join(MOBILE_SRC, specifier.slice(2));
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    join(base, 'index.ts'),
    join(base, 'index.tsx'),
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

export async function resolve(specifier, context, next) {
  if (specifier === '@react-native-async-storage/async-storage') {
    return { url: STAND_IN, shortCircuit: true };
  }
  if (specifier.startsWith('@/')) {
    const target = resolveAlias(specifier);
    if (target) return { url: pathToFileURL(target).href, shortCircuit: true };
  }
  return next(specifier, context);
}
