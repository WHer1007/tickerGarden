#!/bin/sh
# Local recovery copy. This does not claim independent/off-host protection.
set -eu
umask 077
base=/var/backups/tickergarden-rh
mkdir -p "$base"
chmod 700 "$base"
exec 9>"$base/.lock"
flock -n 9 || exit 0
stamp=$(date -u +%Y%m%dT%H%M%SZ)
# Policies reference role names even when ownership/ACLs are omitted. Credentials
# are deliberately excluded; recovery provisions login secrets separately.
roles="$base/roles-$stamp.sql"
docker exec tickergarden-postgres-prod-1 psql -XqAt -U tg_admin -d tickergarden -v ON_ERROR_STOP=1 -c "SELECT format('CREATE ROLE %I NOLOGIN;',rolname) FROM pg_roles WHERE rolname !~ '^pg_' ORDER BY rolname" > "$roles.partial"
test -s "$roles.partial"
mv "$roles.partial" "$roles"
sha256sum "$roles" > "$roles.sha256"
for db in tickergarden tickergarden_queue; do
  target="$base/$db-$stamp.dump"
  trap 'rm -f "$target.partial"' EXIT HUP INT TERM
  docker exec tickergarden-postgres-prod-1 pg_dump -U tg_admin -Fc --no-owner --no-acl "$db" > "$target.partial"
  test -s "$target.partial"
  docker exec -i tickergarden-postgres-prod-1 pg_restore --list < "$target.partial" > /dev/null
  mv "$target.partial" "$target"
  sha256sum "$target" > "$target.sha256"
  trap - EXIT HUP INT TERM
done
date -u +%FT%TZ > "$base/last-success"
# Retention is intentionally disabled until an independent copy is accepted.
