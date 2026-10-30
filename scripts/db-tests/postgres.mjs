/**
 * postgres.mjs — find, boot and talk to a throwaway PostgreSQL cluster.
 *
 * This is the cross-platform half of `npm run test:db`. It exists because the
 * old runner was a bash script that used a Unix domain socket and bare
 * `pg_ctl`/`initdb` names. None of that works on a Windows laptop, and Windows
 * is now the machine the shop's developer uses. The rules under test did not
 * change; only the way the cluster is started did.
 *
 * What it guarantees:
 *   - It never touches the PostgreSQL service already installed on the machine.
 *     It creates a fresh cluster in the OS temp directory on a free localhost
 *     port, applies the migrations, runs the tests, and deletes it.
 *   - It finds PostgreSQL in the usual Windows install location
 *     (`C:\Program Files\PostgreSQL\<version>\bin`) without asking the user to
 *     edit PATH. `PGBIN` overrides the search.
 *   - Client encoding is forced to UTF8, because the seed contains Kannada and
 *     a Windows console is not UTF-8 by default.
 */

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const isWindows = process.platform === 'win32';
export const exe = isWindows ? '.exe' : '';

/** Version directories sort descending: 18, 16, 15, 9.6 … */
function versionRank(path) {
  const match = path.match(/[/\\]PostgreSQL[/\\]([0-9]+)(?:[./\\]|$)/i)
    ?? path.match(/[/\\]postgresql[/\\]([0-9]+)(?:[/\\]|$)/i)
    ?? path.match(/([0-9]+)(?:\.[0-9]+)?[/\\]bin$/);
  return match ? Number(match[1]) : 0;
}

/**
 * @returns {string|null|undefined} a bin directory, `null` for "use PATH",
 *   or `undefined` when no PostgreSQL installation can be found.
 */
export function findPgBin() {
  const explicit = process.env.PGBIN;
  if (explicit) {
    return existsSync(join(explicit, `pg_ctl${exe}`)) ? explicit : undefined;
  }

  // A PostgreSQL bin directory already on PATH is the simplest case.
  const onPath = spawnSync(`pg_ctl${exe}`, ['--version'], {
    stdio: 'ignore',
    shell: false,
  });
  if (!onPath.error && onPath.status === 0) return null;

  const candidates = [];
  if (isWindows) {
    const roots = new Set(
      [
        process.env.ProgramFiles,
        process.env['ProgramFiles(x86)'],
        'C:\\Program Files',
        'C:\\Program Files (x86)',
      ].filter(Boolean),
    );
    for (const root of roots) {
      const family = join(root, 'PostgreSQL');
      if (!existsSync(family)) continue;
      for (const version of readdirSync(family)) {
        candidates.push(join(family, version, 'bin'));
      }
    }
  } else {
    for (const fixed of [
      '/usr/lib/postgresql/16/bin',
      '/usr/lib/postgresql/15/bin',
      '/usr/local/pgsql/bin',
      '/opt/homebrew/opt/postgresql@16/bin',
      '/usr/local/opt/postgresql@16/bin',
    ]) {
      candidates.push(fixed);
    }
    const family = '/usr/lib/postgresql';
    if (existsSync(family)) {
      for (const version of readdirSync(family)) {
        candidates.push(join(family, version, 'bin'));
      }
    }
  }

  candidates.sort((a, b) => versionRank(b) - versionRank(a));
  for (const candidate of candidates) {
    if (existsSync(join(candidate, `pg_ctl${exe}`))) return candidate;
  }
  return undefined;
}

export function describeMissingPostgres() {
  if (isWindows) {
    return [
      'No PostgreSQL server binaries found (looked for pg_ctl.exe and initdb.exe).',
      '',
      'Install PostgreSQL 16 for Windows (the EDB installer is the usual one):',
      '  https://www.postgresql.org/download/windows/',
      '',
      'The tests do NOT use the service the installer creates. They only need the',
      'binaries. If PostgreSQL is installed somewhere unusual, point at its bin',
      'folder for this terminal:',
      '',
      '  PowerShell:  $env:PGBIN = "C:\\Program Files\\PostgreSQL\\16\\bin"',
      '  Command Prompt:  set PGBIN=C:\\Program Files\\PostgreSQL\\16\\bin',
    ].join('\n');
  }
  return [
    'No PostgreSQL server binaries found (looked for pg_ctl and initdb).',
    'Install PostgreSQL 16, or set PGBIN=/path/to/postgresql/bin.',
  ].join('\n');
}

function binPath(pgbin, name) {
  return pgbin ? join(pgbin, `${name}${exe}`) : `${name}${exe}`;
}

/** One free TCP port on localhost. Closed again before PostgreSQL binds it. */
function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    ...options,
  });
}

function indent(text) {
  return text
    .split(/\r?\n/)
    .filter((line) => line.length > 0)
    .map((line) => `    ${line}`)
    .join('\n');
}

/**
 * Boot a fresh cluster. Returns an object with `psql`, `q`, `raw`, `stop`.
 *
 * @param {{ keep?: boolean }} options
 */
export async function startCluster({ keep = false } = {}) {
  const pgbin = findPgBin();
  if (pgbin === undefined) {
    const error = new Error(describeMissingPostgres());
    error.expected = true;
    throw error;
  }

  const workdir = mkdtempSync(join(tmpdir(), 'grocery-dbtest-'));
  const data = join(workdir, 'data');
  const logfile = join(workdir, 'postgres.log');
  const port = await freePort();

  const env = {
    ...process.env,
    PGHOST: '127.0.0.1',
    PGPORT: String(port),
    PGUSER: 'postgres',
    PGDATABASE: 'grocery_test',
    PGPASSWORD: '',
    PGCLIENTENCODING: 'UTF8',
    // A global `PGSSLMODE=require` would make libpq demand TLS from a throwaway
    // server that has none, and a global service file would silently point the
    // tests at a different database.
    PGSSLMODE: 'disable',
    // Keep notices (which carry pass/fail lines) but not the empty result sets.
    PGOPTIONS: '--client-min-messages=notice',
  };
  delete env.PGSERVICE;
  delete env.PGSERVICEFILE;
  delete env.PGHOSTADDR;

  const postgresVersion = run(binPath(pgbin, 'postgres'), ['--version'], { env });
  if (postgresVersion.error || postgresVersion.status !== 0) {
    throw new Error(
      `PostgreSQL found at ${pgbin ?? 'PATH'} but \`postgres --version\` failed:\n${
        postgresVersion.error?.message ?? postgresVersion.stderr
      }`,
    );
  }
  const versionText = postgresVersion.stdout.trim() || postgresVersion.stderr.trim();
  const major = Number(versionText.match(/([0-9]+)(?:\.[0-9]+)?/)?.[1] ?? 0);
  if (major && major < 13) {
    throw new Error(
      `PostgreSQL ${major} is too old. This schema uses generated columns and gen_random_uuid(); install 13 or newer (16 is what CI uses).`,
    );
  }

  const initdb = run(
    binPath(pgbin, 'initdb'),
    [
      '-D',
      data,
      '-U',
      'postgres',
      '--auth=trust',
      '--encoding=UTF8',
      '--locale=C',
      '--no-sync',
    ],
    { env },
  );
  if (initdb.status !== 0) {
    throw new Error(
      `initdb failed:\n${indent(`${initdb.stdout}\n${initdb.stderr}`)}\n\n` +
        'On Windows, run this from a normal (non-Administrator) terminal and make ' +
        'sure the TEMP directory is writable.',
    );
  }

  // On Unix, keep the cluster off `/var/run/postgresql` (permission denied on
  // many boxes) by disabling the Unix socket entirely. On Windows there is no
  // Unix socket to disable, and Windows command-line parsing does not understand
  // the single quotes, so the option is left out there.
  const socketOption = isWindows ? '' : ` -c unix_socket_directories=''`;
  const started = run(
    binPath(pgbin, 'pg_ctl'),
    [
      '-D',
      data,
      '-l',
      logfile,
      '-w',
      '-t',
      '60',
      '-o',
      `-p ${port} -c listen_addresses=127.0.0.1${socketOption} -c fsync=off -c full_page_writes=off -c synchronous_commit=off`,
      'start',
    ],
    { env },
  );
  if (started.status !== 0) {
    const log = existsSync(logfile) ? readFileSync(logfile, 'utf8') : '';
    throw new Error(
      `could not start PostgreSQL:\n${indent(`${started.stdout}\n${started.stderr}\n${log}`)}`,
    );
  }

  const createdb = run(binPath(pgbin, 'createdb'), ['grocery_test'], { env });
  if (createdb.status !== 0) {
    run(binPath(pgbin, 'pg_ctl'), ['-D', data, '-m', 'immediate', 'stop'], { env });
    throw new Error(`createdb failed:\n${indent(createdb.stderr)}`);
  }

  const psqlPath = binPath(pgbin, 'psql');

  /** Raw psql, with the cluster's environment already applied. */
  function psql(args, options = {}) {
    return run(psqlPath, ['-X', ...args], { env, ...options });
  }

  /** One query, tuple-only: the value a shell pipeline would have read. */
  function q(sql) {
    const result = psql(['-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1', '-c', sql]);
    if (result.status !== 0) {
      throw new Error(`query failed:\n${indent(result.stderr || result.stdout)}`);
    }
    return (result.stdout ?? '').trim();
  }

  /** Run a .sql file, echoing its notices. Query output goes to the OS null. */
  function runSql(label, file) {
    console.log(`--- ${label}`);
    const result = psql([
      '-q',
      '-o',
      process.platform === 'win32' ? 'NUL' : '/dev/null',
      '-v',
      'ON_ERROR_STOP=1',
      '-f',
      file,
    ]);
    const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
    if (output.trim()) console.log(indent(output));
    if (result.status !== 0) {
      const error = new Error(`${label} failed`);
      error.output = output;
      throw error;
    }
  }

  let stopped = false;
  function stop() {
    if (stopped) return;
    stopped = true;
    run(binPath(pgbin, 'pg_ctl'), ['-D', data, '-m', 'immediate', 'stop'], { env });
    try {
      rmSync(workdir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch {
      // Windows sometimes keeps a handle on the log for a moment. A stale temp
      // directory is not a test failure.
    }
  }

  return {
    psql,
    psqlPath,
    env,
    q,
    runSql,
    stop,
    keep,
    workdir,
    data,
    port,
    versionText,
    connection: `psql -h 127.0.0.1 -p ${port} -U postgres -d grocery_test`,
  };
}
