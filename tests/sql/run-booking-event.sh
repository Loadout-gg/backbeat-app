#!/bin/sh
# Runs tests/sql/booking-event.sql (migration 008) and booking-event-finance.sql (008 with
# 007 + 010, numeric and staging apply order), each on its own THROWAWAY local PostgreSQL 17 cluster.
# No Docker, no Supabase stack, no network: the cluster listens on a private unix socket
# only and is deleted on exit. The auth schema is a stub (see local-stub.sql), so a PASS
# here is not proof of hosted Auth/PostgREST behaviour. Not part of CI.
# Separate from run-local.sh so parallel branches do not edit the same runner.
# Usage: PG_BIN=/path/to/postgresql-17/bin sh tests/sql/run-booking-event.sh
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
# The tests read ops files through psql backticks, relative to this directory.
cd "$here"
run() { # run <name> <suite> [psql args...]
  dir="$work/$1"; suite=$2; shift 2
  mkdir "$dir"
  "$bin/initdb" -D "$dir/data" -U postgres -A trust -E UTF8 --no-locale >/dev/null
  "$bin/pg_ctl" -D "$dir/data" -w -l "$dir/log" \
    -o "-c listen_addresses='' -c unix_socket_directories='$dir' -c timezone=UTC" start >/dev/null
  "$bin/psql" -X -q -v ON_ERROR_STOP=1 -h "$dir" -U postgres -d postgres "$@" -f "$here/$suite.sql"
  "$bin/pg_ctl" -D "$dir/data" -m immediate stop >/dev/null
}
run event booking-event
run finance-numeric booking-event-finance -v apply_order=numeric
run finance-staging booking-event-finance -v apply_order=staging
