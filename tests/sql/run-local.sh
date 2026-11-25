#!/bin/sh
# Runs tests/sql/booking-lifecycle.sql, booking-finance.sql and booking-payment-history.sql, each on its own THROWAWAY
# local PostgreSQL 17 cluster.
# No Docker, no Supabase stack, no network: each cluster listens on a private unix socket
# only and is deleted on exit. The auth schema is a stub (see local-stub.sql), so a PASS
# here is not proof of hosted Auth/PostgREST behaviour. Not part of CI.
# Usage: PG_BIN=/path/to/postgresql-17/bin sh tests/sql/run-local.sh
set -eu
here=$(cd "$(dirname "$0")" && pwd)
bin=${PG_BIN:?Set PG_BIN to a PostgreSQL 17 bin directory}
work=$(mktemp -d "${TMPDIR:-/tmp}/bb-sql.XXXXXX")
cleanup() {
  for data in "$work"/*/data; do
    [ -d "$data" ] && "$bin/pg_ctl" -D "$data" -m immediate stop >/dev/null 2>&1 || true
  done
  rm -rf "$work"
}
trap cleanup EXIT INT TERM
# The finance test reads ops files through psql backticks, relative to this directory.
cd "$here"
for suite in booking-lifecycle booking-finance booking-payment-history; do
  dir="$work/$suite"
  mkdir "$dir"
  "$bin/initdb" -D "$dir/data" -U postgres -A trust -E UTF8 --no-locale >/dev/null
  "$bin/pg_ctl" -D "$dir/data" -w -l "$dir/log" \
    -o "-c listen_addresses='' -c unix_socket_directories='$dir' -c timezone=UTC" start >/dev/null
  "$bin/psql" -X -q -v ON_ERROR_STOP=1 -h "$dir" -U postgres -d postgres -f "$here/$suite.sql"
  "$bin/pg_ctl" -D "$dir/data" -m immediate stop >/dev/null
done
