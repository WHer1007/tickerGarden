#!/bin/sh
# Run against a dedicated empty database via a separate pg_service entry.
set -eu
export LC_ALL=C
umask 077
: "${TG_RESTORE_SERVICE:?required isolated target service}"
: "${TG_RESTORE_ALLOW_DATABASE:?required exact disposable target name}"
[ "$TG_RESTORE_ALLOW_DATABASE" != postgres ] || exit 1
case "$TG_RESTORE_ALLOW_DATABASE" in tg_restore_*) ;; *) echo 'target must start tg_restore_' >&2; exit 1;; esac
[ "$#" = 1 ] || { echo 'usage: restore-postgres-drill.sh restored-backup-directory' >&2; exit 1; }
archive=$(cd "$1" && pwd)
(cd "$archive" && shasum -a 256 -c SHA256SUMS)
export PGSERVICE="$TG_RESTORE_SERVICE"
actual=$(psql -X -At -v ON_ERROR_STOP=1 -c 'SELECT current_database()')
[ "$actual" = "$TG_RESTORE_ALLOW_DATABASE" ] || { echo 'target identity mismatch' >&2; exit 1; }
objects=$(psql -X -At -v ON_ERROR_STOP=1 -c "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname<>'information_schema' AND c.relkind IN ('r','p','v','m')")
[ "$objects" = 0 ] || { echo 'restore target is not empty' >&2; exit 1; }
pg_restore --exit-on-error --single-transaction --no-owner --no-acl --dbname="service=$TG_RESTORE_SERVICE" "$archive/database.dump"
psql -X -v ON_ERROR_STOP=1 -c 'SELECT current_database(),now() AS restored_at'
echo 'RESTORED: run application migration digest, publication, queue dedup and object-reference checks before accepting recovery'
