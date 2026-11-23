#!/bin/sh
# Runs tests/sql/booking-lifecycle.sql on a THROWAWAY local PostgreSQL 17 cluster.
# No Docker, no Supabase stack, no network: the cluster listens on a private unix socket
# only and is deleted on exit. The auth schema is a stub (see local-stub.sql), so a PASS
# here is not proof of hosted Auth/PostgREST behaviour. Not part of CI.
# Usage: PG_BIN=/path/to/postgresql-17/bin sh tests/sql/run-local.sh
set -eu
here=$(cd "$(dirname "$0")" && pwd)
bin=${PG_BIN:?Set PG_BIN to a PostgreSQL 17 bin directory}
work=$(mktemp -d "${TMPDIR:-/tmp}/bb-sql.XXXXXX")
cleanup() { "$bin/pg_ctl" -D "$work/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$work"; }
trap cleanup EXIT INT TERM
"$bin/initdb" -D "$work/data" -U postgres -A trust -E UTF8 --no-locale >/dev/null
"$bin/pg_ctl" -D "$work/data" -w -l "$work/log" \
  -o "-c listen_addresses='' -c unix_socket_directories='$work' -c timezone=UTC" start >/dev/null
"$bin/psql" -X -q -v ON_ERROR_STOP=1 -h "$work" -U postgres -d postgres \
  -f "$here/booking-lifecycle.sql"
