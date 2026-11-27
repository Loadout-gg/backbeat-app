#!/bin/sh
# Runs SQL contract suites, each on its own THROWAWAY local PostgreSQL 17 cluster. Default:
# booking-lifecycle, booking-finance and booking-payment-history; name suites to run only those
# (booking-travel and travel-documents are opt-in).
# No Docker, no Supabase stack, no network: each cluster listens on a private unix socket
# only and is deleted on exit. The auth schema is a stub (see local-stub.sql), so a PASS
# here is not proof of hosted Auth/PostgREST behaviour. Not part of CI.
# Usage: PG_BIN=/path/to/postgresql-17/bin sh tests/sql/run-local.sh [suite ...]
set -eu
here=$(cd "$(dirname "$0")" && pwd)
suites=${*:-booking-lifecycle booking-finance booking-payment-history}
for suite in $suites; do
  case $suite in
    booking-lifecycle|booking-finance|booking-payment-history|booking-travel|travel-documents) ;;
    *) echo "unknown suite: $suite" >&2; exit 2 ;;
  esac
done
bin=${PG_BIN:?Set PG_BIN to a PostgreSQL 17 bin directory}
work=$(mktemp -d "${TMPDIR:-/tmp}/bb-sql.XXXXXX")
cleanup() {
  for data in "$work"/*/data; do
    [ -d "$data" ] && "$bin/pg_ctl" -D "$data" -m immediate stop >/dev/null 2>&1 || true
  done
  rm -rf "$work"
}
trap cleanup EXIT INT TERM
# Suites read ops files through psql backticks, relative to this directory.
cd "$here"
for suite in $suites; do
  dir="$work/$suite"
  mkdir "$dir"
  "$bin/initdb" -D "$dir/data" -U postgres -A trust -E UTF8 --no-locale >/dev/null
  "$bin/pg_ctl" -D "$dir/data" -w -l "$dir/log" \
    -o "-c listen_addresses='' -c unix_socket_directories='$dir' -c timezone=UTC" start >/dev/null
  # socket_dir lets a suite open a second session (dblink) for its lock-barrier tests.
  "$bin/psql" -X -q -v ON_ERROR_STOP=1 -v socket_dir="$dir" -h "$dir" -U postgres -d postgres -f "$here/$suite.sql"
  "$bin/pg_ctl" -D "$dir/data" -m immediate stop >/dev/null
done
