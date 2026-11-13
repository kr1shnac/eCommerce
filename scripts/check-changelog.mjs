#!/usr/bin/env node
/**
 * check-changelog.mjs — the build log cannot lose a heading it once had.
 *
 * Run:  npm run check:changelog   (part of `npm run lint`)
 *
 * WHY THIS EXISTS
 *
 * `CHANGELOG.md` has been destroyed twice by a session that used `write` on it
 * instead of prepending with `edit`: every earlier session's history vanished
 * in one keystroke, and `git checkout HEAD -- CHANGELOG.md` was the rescue.
 * The owner's directive (2026-11-13) was to either split the log into
 * per-session files or add a check that heading counts never decrease. The
 * check is the smaller machine and directly addresses the failure mode.
 *
 * WHAT IT PROVES
 *
 *   1. THE DIRECTIVE, literally: the working tree has at least as many
 *      `## ` session headings as the committed version.
 *   2. THE STRONGER FORM of the same rule: the committed heading sequence is
 *      the SUFFIX of the working tree's sequence. The log grows at the TOP;
 *      nothing below the newest entry may be renamed, reordered or dropped —
 *      not even if a new entry replaces the count. (Section BODIES stay
 *      editable; only the heading lines are compared.)
 *
 * The baseline is `git show HEAD:CHANGELOG.md`, so there is no second file to
 * maintain: committing an entry is what makes it history. Without git (or a
 * HEAD) the check says so and passes — there is nothing to compare against.
 *
 * Exit code 1 = the log lost or rewrote history. Fix by prepending with
 * `edit`, never `write`; restore with `git checkout HEAD -- CHANGELOG.md` if
 * a `write` already happened.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function headings(text) {
  return text
    .split(/\r?\n/)
    .filter((line) => line.startsWith('## '))
    .map((line) => line.trim());
}

function committedChangelog() {
  try {
    return execFileSync('git', ['show', 'HEAD:CHANGELOG.md'], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return null;
  }
}

const working = headings(readFileSync(join(root, 'CHANGELOG.md'), 'utf8'));
const committed = committedChangelog();

if (committed === null) {
  console.log('changelog OK — no committed CHANGELOG.md to compare against yet; nothing proven.');
  process.exit(0);
}

const base = headings(committed);
const problems = [];

if (working.length < base.length) {
  problems.push(
    `the log shrank: ${working.length} headings now, ${base.length} committed ` +
      "(the write-instead-of-edit accident).",
  );
}

// The committed sequence must survive, in order, as the TAIL of the working
// list — the log is prepended to, so the newest entry sits above it.
const start = working.length - base.length;
for (let i = 0; i < base.length; i++) {
  if (working[start + i] !== base[i]) {
    problems.push(
      `heading ${i + 1} of the committed log changed: ` +
        `committed "${base[i].slice(0, 60)}" vs working ` +
        `"${(working[start + i] ?? '(missing)').slice(0, 60)}".`,
    );
    break;
  }
}

if (problems.length > 0) {
  console.error('changelog FAILED:');
  for (const problem of problems) console.error(`  - ${problem}`);
  console.error(
    '  Prepend with `edit`, never `write`. If a write already happened:',
    'git checkout HEAD -- CHANGELOG.md, then redo the entry.',
  );
  process.exit(1);
}

console.log(
  `changelog OK — ${working.length} headings; all ${base.length} committed ` +
    'entries intact below the newest.',
);
