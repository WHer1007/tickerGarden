#!/bin/sh
set -eu
install -o postgres -g postgres -m 0644 /run/tickergarden/postgres.crt /var/lib/postgresql/server.crt
install -o postgres -g postgres -m 0600 /run/tickergarden/postgres.key /var/lib/postgresql/server.key
exec docker-entrypoint.sh "$@"
