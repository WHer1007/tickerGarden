#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
PG_BIN=${PG_BIN:-/opt/homebrew/opt/postgresql@14/bin}
DATA="$ROOT/.codex_tmp/postgres/data"
LOG="$ROOT/.codex_tmp/postgres/postgres.log"
PORT=54329

case "${1:-status}" in
  start)
    test -x "$PG_BIN/initdb" || { echo "PostgreSQL 14 binaries not found at $PG_BIN" >&2; exit 1; }
    mkdir -p "$(dirname "$DATA")"
    if test ! -f "$DATA/PG_VERSION"; then
      "$PG_BIN/initdb" -D "$DATA" -U tickergarden --auth=trust --no-locale --encoding=UTF8 >/dev/null
    fi
    if ! "$PG_BIN/pg_ctl" -D "$DATA" status >/dev/null 2>&1; then
      "$PG_BIN/pg_ctl" -D "$DATA" -l "$LOG" -o "-p $PORT -h 127.0.0.1" start
    fi
    if ! "$PG_BIN/psql" -h 127.0.0.1 -p "$PORT" -U tickergarden -d postgres -Atqc "SELECT 1 FROM pg_database WHERE datname='tickergarden'" | grep -q 1; then
      "$PG_BIN/createdb" -h 127.0.0.1 -p "$PORT" -U tickergarden tickergarden
    fi
    "$PG_BIN/psql" -h 127.0.0.1 -p "$PORT" -U tickergarden -d postgres -qc "ALTER ROLE tickergarden PASSWORD 'tickergarden_dev';"
    "$PG_BIN/pg_isready" -h 127.0.0.1 -p "$PORT"
    ;;
  stop)
    test -f "$DATA/PG_VERSION" && "$PG_BIN/pg_ctl" -D "$DATA" stop || true
    ;;
  status)
    "$PG_BIN/pg_isready" -h 127.0.0.1 -p "$PORT"
    ;;
  *)
    echo "usage: $0 start|stop|status" >&2
    exit 2
    ;;
esac
