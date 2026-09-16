#!/bin/sh
# PG service files and restic credentials are read from the service environment.
# No credentials or database content are written to logs.
set -eu
export LC_ALL=C
umask 077
: "${PGSERVICE:?required}"
: "${RESTIC_REPOSITORY:?required}"
: "${RESTIC_PASSWORD_FILE:?required}"
: "${TG_BACKUP_FAILURE_DOMAIN:?independent provider/host identifier required}"
: "${TG_SOURCE_FAILURE_DOMAIN:?source host identifier required}"
[ "$TG_BACKUP_FAILURE_DOMAIN" != "$TG_SOURCE_FAILURE_DOMAIN" ] || { echo 'backup destination shares source failure domain' >&2; exit 1; }
case "$RESTIC_REPOSITORY" in s3:*|sftp:*|rest:*) ;; *) echo 'off-host repository required' >&2; exit 1;; esac
command -v restic >/dev/null
command -v pg_dump >/dev/null
stage=$(mktemp -d)
trap 'rm -rf "$stage"' EXIT HUP INT TERM
pg_dump --format=custom --no-owner --no-acl --file="$stage/database.dump"
pg_restore --list "$stage/database.dump" > "$stage/toc.txt"
# These are deployment facts, not application secrets.
psql -X -At -v ON_ERROR_STOP=1 -c 'SELECT version()' > "$stage/server-version.txt"
printf '%s\n' "$TG_SOURCE_FAILURE_DOMAIN" > "$stage/source-domain.txt"
(cd "$stage" && shasum -a 256 database.dump > SHA256SUMS)
restic backup "$stage" --tag tickergarden-postgres --tag "$PGSERVICE" --json
restic check
# No forget/prune here: retention requires an accepted independent restore drill.
