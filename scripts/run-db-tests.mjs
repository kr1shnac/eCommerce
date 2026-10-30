#!/usr/bin/env node
/**
 * run-db-tests.mjs — `npm run test:db` on every OS.
 *
 * Boots a throwaway PostgreSQL in a temporary directory, applies every
 * migration in filename order, loads the seed and fixtures, runs every
 * `*_test.sql` file, then the two-session concurrency suite, then prints a
 * pass/fail summary and throws the whole thing away. Nothing on your machine is
 * touched, and you do not need Docker or a running PostgreSQL service.
 *
 *   npm run test:db
 *   node scripts/run-db-tests.mjs --keep   # leave the server running to poke at
 *
 * Why this replaced `supabase/tests/run.sh`
 * -----------------------------------------
 * The shop's development machine is now a Windows laptop. The old runner was
 * bash, used a Unix domain socket, and assumed `/usr/lib/postgresql`. None of
 * that exists on Windows. This runner uses TCP on a free localhost port, finds
 * `C:\Program Files\PostgreSQL\*\bin` automatically, and forces UTF-8 so the
 * Kannada seed data survives a Windows console.
 *
 * Rule 9.7: this is what makes "there is a test for it" true rather than a claim.
 */

import { existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { runConcurrencyTest } from './db-tests/concurrency.mjs';
import { startCluster } from './db-tests/postgres.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const tests = join(root, 'supabase', 'tests');
const keep = process.argv.includes('--keep');

/** `YYYYMMDDHHMMSS_name.sql` sorts correctly as plain text. */
function sqlFiles(dir) {
  return readdirSync(dir)
    .filter((name) => name.endsWith('.sql'))
    .sort();
}

function printSummary(db) {
  const [passed, failed, total] = db
    .q(
      `select count(*) filter (where ok),
              count(*) filter (where not ok),
              count(*)
         from test_result.assertions;`,
    )
    .split('|');

  const width = Math.max('passed'.length, passed.length);
  console.log();
  console.log(` ${'passed'.padStart(width)} | ${'failed'.padStart(6)} | ${'total'.padStart(6)}`);
  console.log(`${'-'.repeat(width + 2)}+${'-'.repeat(8)}+${'-'.repeat(8)}`);
  console.log(` ${passed.padStart(width)} | ${failed.padStart(6)} | ${total.padStart(6)}`);

  if (failed !== '0') {
    console.log('\nFAILURES');
    const result = db.psql([
      '-c',
      `select suite, name, detail
         from test_result.assertions
        where not ok
        order by n;`,
    ]);
    if (result.stdout) console.log(result.stdout.trimEnd());
    console.log(`\nRESULT: ${failed} assertion(s) failed`);
    return false;
  }

  console.log('\nRESULT: all assertions passed');
  return true;
}

async function main() {
  const db = await startCluster({ keep });
  let stopped = false;

  const shutdown = (signal) => {
    if (stopped) return;
    stopped = true;
    if (!keep) db.stop();
    process.exit(signal === 'SIGINT' ? 130 : 143);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  try {
    console.log(`postgres: ${db.versionText}`);
    console.log(`cluster:  ${db.workdir}`);
    console.log(`server:   ${db.connection}`);
    console.log();

    db.runSql('auth stub + assertion helpers', join(tests, 'support', '00_auth_stub.sql'));

    for (const name of sqlFiles(join(root, 'supabase', 'migrations'))) {
      db.runSql(`migration ${name}`, join(root, 'supabase', 'migrations', name));
    }

    db.runSql('seed', join(root, 'supabase', 'seed.sql'));
    db.runSql('fixtures', join(tests, 'support', '02_fixtures.sql'));

    for (const name of sqlFiles(tests).filter((name) => name.endsWith('_test.sql'))) {
      db.runSql(`test ${name}`, join(tests, name));
    }

    // The two-buyers-one-unit race needs two real sessions at the same time, so
    // it lives in JavaScript rather than SQL.
    await runConcurrencyTest({ db });

    const ok = printSummary(db);

    if (keep) {
      console.log();
      console.log('server left running (--keep):');
      console.log(`  ${db.connection}`);
      console.log(`  stop it with: pg_ctl -D "${db.data}" -m immediate stop`);
      stopped = true;
      process.exitCode = ok ? 0 : 1;
      return;
    }

    stopped = true;
    db.stop();
    process.exitCode = ok ? 0 : 1;
  } catch (error) {
    console.error();
    if (error.expected) {
      // The "no PostgreSQL found" message is already written for a human.
      console.error(error.message);
      console.error();
      console.error('Nothing was changed on this machine.');
      process.exitCode = 127;
    } else {
      console.error(`error: ${error.message}`);
      if (error.output) console.error(error.output.trimEnd());
      process.exitCode = 1;
    }
    if (!keep) db.stop();
    stopped = true;
  }
}

await main();
