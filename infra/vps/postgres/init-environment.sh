#!/bin/sh
set -eu
export PGPASSWORD="$POSTGRES_PASSWORD"
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  -v read_password="$TG_READ_PASSWORD" -v content_password="$TG_CONTENT_PASSWORD" \
  -v pipeline_password="$TG_PIPELINE_PASSWORD" <<'SQL'
CREATE ROLE tg_read_api LOGIN PASSWORD :'read_password';
CREATE ROLE tg_content LOGIN PASSWORD :'content_password';
CREATE ROLE tg_pipeline LOGIN PASSWORD :'pipeline_password';
SQL
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres \
  -v queue_password="$TG_QUEUE_PASSWORD" <<'SQL'
CREATE ROLE tg_queue LOGIN PASSWORD :'queue_password';
CREATE DATABASE tickergarden_queue OWNER tg_queue;
SQL
