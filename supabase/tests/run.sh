#!/usr/bin/env bash
#
# Runs every database test against a real PostgreSQL server.
#
# It boots a throwaway Postgres in a temporary directory, applies every
# migration in filename order, loads the seed, creates fixtures, runs the test
# files, then prints a pass/fail summary and throws the whole thing away.
# Nothing on your machine is touched, and you do not need Docker.
#
#   ./supabase/tests/run.sh
#   ./supabase/tests/run.sh --keep     # leave the server running to poke at it
#
# Rule 9.7: this is what makes "there is a test for it" true rather than a claim.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TESTS="$ROOT/supabase/tests"

KEEP=0
[ "${1:-}" = "--keep" ] && KEEP=1

# -----------------------------------------------------------------------------
# Find PostgreSQL
# -----------------------------------------------------------------------------
find_pgbin() {
  if [ -n "${PGBIN:-}" ] && [ -x "$PGBIN/psql" ]; then
    echo "$PGBIN"
    return
  fi
  if command -v pg_ctl >/dev/null 2>&1 && command -v initdb >/dev/null 2>&1; then
    dirname "$(command -v pg_ctl)"
    return
  fi
  # Prefer 16 when it is there, otherwise the newest version installed.
  local candidate
  for candidate in /usr/lib/postgresql/16/bin /usr/lib/postgresql/15/bin \
                   /usr/local/pgsql/bin /opt/homebrew/opt/postgresql@16/bin \
                   /usr/local/opt/postgresql@16/bin; do
    if [ -x "$candidate/pg_ctl" ]; then
      echo "$candidate"
      return
    fi
  done
  for candidate in $(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -Vr); do
    if [ -x "$candidate/pg_ctl" ]; then
      echo "$candidate"
      return
    fi
  done
  echo ""
}

PGBIN="$(find_pgbin)"
if [ -z "$PGBIN" ]; then
  echo "error: no PostgreSQL server binaries found (looked for pg_ctl and initdb)." >&2
  echo "       install postgresql, or set PGBIN=/path/to/pg/bin" >&2
  exit 127
fi

WORKDIR="$(mktemp -d "${TMPDIR:-/tmp}/grocery-dbtest-XXXXXX")"
PGDATA="$WORKDIR/data"
SOCKET_DIR="$WORKDIR/socket"
PGLOG="$WORKDIR/postgres.log"
PGPORT=54399

mkdir -p "$SOCKET_DIR"

export PGHOST="$SOCKET_DIR"
export PGPORT="$PGPORT"
export PGUSER=postgres
export PGDATABASE=grocery_test
export PGPASSWORD=""
# Keep output machine-ish but readable.
export PGOPTIONS="--client-min-messages=notice"

stop_server() {
  if [ -f "$PGDATA/postmaster.pid" ]; then
    "$PGBIN/pg_ctl" -D "$PGDATA" -m immediate stop >/dev/null 2>&1 || true
  fi
}

cleanup() {
  if [ "$KEEP" -eq 1 ]; then
    echo
    echo "server left running (--keep):"
    echo "  psql -h $SOCKET_DIR -p $PGPORT -U postgres -d grocery_test"
    echo "  stop it with: $PGBIN/pg_ctl -D $PGDATA stop"
    return
  fi
  stop_server
  rm -rf "$WORKDIR"
}
trap cleanup EXIT

# -----------------------------------------------------------------------------
# Boot the server
# -----------------------------------------------------------------------------
echo "postgres: $("$PGBIN/postgres" --version)"

"$PGBIN/initdb" -D "$PGDATA" -U postgres --auth=trust --encoding=UTF8 \
  --locale=C >"$WORKDIR/initdb.log" 2>&1 || {
  echo "error: initdb failed" >&2; cat "$WORKDIR/initdb.log" >&2; exit 1; }

# Socket only: no TCP port, so this can never clash with a Postgres you already run.
"$PGBIN/pg_ctl" -D "$PGDATA" -l "$PGLOG" -w -t 30 \
  -o "-k $SOCKET_DIR -p $PGPORT -c listen_addresses='' -c fsync=off -c full_page_writes=off" \
  start >/dev/null || { echo "error: could not start postgres" >&2; cat "$PGLOG" >&2; exit 1; }

"$PGBIN/createdb" grocery_test
echo "server up on socket $SOCKET_DIR"
echo

# -----------------------------------------------------------------------------
# Helper
# -----------------------------------------------------------------------------
run_sql() {
  local label="$1" file="$2"
  echo "--- $label"
  # -o /dev/null hides the empty result set that every `select test_result.ok(...)`
  # prints. Notices (which carry the pass/fail lines) and errors still show.
  if ! "$PGBIN/psql" -X -q -o /dev/null -v ON_ERROR_STOP=1 -f "$file" 2>&1 | sed 's/^/    /'; then
    echo "!!! $label failed" >&2
    exit 1
  fi
}

# -----------------------------------------------------------------------------
# Build the schema
# -----------------------------------------------------------------------------
run_sql "auth stub + assertion helpers" "$TESTS/support/00_auth_stub.sql"

for f in "$ROOT"/supabase/migrations/*.sql; do
  run_sql "migration $(basename "$f")" "$f"
done

run_sql "seed" "$ROOT/supabase/seed.sql"
run_sql "fixtures" "$TESTS/support/02_fixtures.sql"

# -----------------------------------------------------------------------------
# Tests
# -----------------------------------------------------------------------------
for f in "$TESTS"/*_test.sql; do
  [ -e "$f" ] || continue
  run_sql "test $(basename "$f")" "$f"
done

# The two-buyers-one-unit race needs two real sessions at the same time, so it
# lives in shell rather than SQL.
if [ -x "$TESTS/04_concurrency_test.sh" ]; then
  echo "--- test 04_concurrency_test.sh"
  if ! "$TESTS/04_concurrency_test.sh" "$TESTS" 2>&1 | sed 's/^/    /'; then
    echo "!!! concurrency test harness failed" >&2
    exit 1
  fi
fi

# -----------------------------------------------------------------------------
# Summary
# -----------------------------------------------------------------------------
echo
"$PGBIN/psql" -X -q -c "
  select
    count(*) filter (where ok)     as passed,
    count(*) filter (where not ok) as failed,
    count(*)                       as total
  from test_result.assertions;
"

FAILED="$("$PGBIN/psql" -X -t -A -c "select count(*) from test_result.assertions where not ok;")"

if [ "$FAILED" != "0" ]; then
  echo
  echo "FAILURES"
  "$PGBIN/psql" -X -c "
    select suite, name, detail
    from test_result.assertions
    where not ok
    order by n;
  "
  echo
  echo "RESULT: $FAILED assertion(s) failed"
  exit 1
fi

echo "RESULT: all assertions passed"