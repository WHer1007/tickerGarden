#!/bin/sh
# Cold, version-preserving fallback until independent S3 replication is provisioned.
# Never run outside an explicitly scheduled maintenance window.
set -eu
export LC_ALL=C
: "${TG_MINIO_CONTAINER:?exact container required}"
: "${TG_MAINTENANCE_WINDOW_APPROVED:?explicit maintenance window required}"
[ "$TG_MAINTENANCE_WINDOW_APPROVED" = yes ] || exit 1
: "${RESTIC_REPOSITORY:?required}"
: "${RESTIC_PASSWORD_FILE:?required}"
: "${TG_BACKUP_FAILURE_DOMAIN:?required}"
: "${TG_SOURCE_FAILURE_DOMAIN:?required}"
[ "$TG_BACKUP_FAILURE_DOMAIN" != "$TG_SOURCE_FAILURE_DOMAIN" ] || exit 1
case "$RESTIC_REPOSITORY" in s3:*|sftp:*|rest:*) ;; *) exit 1;; esac
case "$TG_MINIO_CONTAINER" in tickergarden-minio-test-[0-9]*|tickergarden-minio-production-[0-9]*) ;; *) echo 'unexpected container' >&2; exit 1;; esac
command -v restic >/dev/null
volume=$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Source}}{{end}}{{end}}' "$TG_MINIO_CONTAINER")
[ -d "$volume" ] && [ "$volume" != / ] || { echo 'MinIO volume missing' >&2; exit 1; }
[ "$(docker inspect --format '{{.State.Running}}' "$TG_MINIO_CONTAINER")" = true ] || { echo 'source must be running before maintenance' >&2; exit 1; }
# Preserve the exact server image identity and all object versions on disk.
metadata=$(mktemp -d)
trap 'docker start "$TG_MINIO_CONTAINER" >/dev/null; rm -rf "$metadata"' EXIT HUP INT TERM
docker inspect --format '{{.Image}}' "$TG_MINIO_CONTAINER" > "$metadata/image-id.txt"
printf '%s\n' "$TG_MINIO_CONTAINER" > "$metadata/container.txt"
docker stop --time 120 "$TG_MINIO_CONTAINER" >/dev/null
restic backup "$volume" "$metadata" --tag tickergarden-minio --tag "$TG_MINIO_CONTAINER" --json
restic check
