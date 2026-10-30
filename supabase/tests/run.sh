#!/usr/bin/env bash
#
# Compatibility wrapper. The real runner is `scripts/run-db-tests.mjs`, because
# Windows has no bash and PostgreSQL on Windows has no Unix domain sockets.
# Kept so `./supabase/tests/run.sh` and old notes still work on macOS and Linux.
#
#   npm run test:db
#   node scripts/run-db-tests.mjs --keep
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
exec node "$ROOT/scripts/run-db-tests.mjs" "$@"
