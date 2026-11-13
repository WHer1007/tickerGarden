-- Reconciled recorded events do not prove a complete upstream chain interval.
ALTER TABLE "{{schema}}".display_health DROP CONSTRAINT display_health_status_check;
ALTER TABLE "{{schema}}".display_health ADD CONSTRAINT display_health_status_check CHECK(status IN ('gap','unverified'));
CREATE TABLE "{{schema}}".display_recovery_runs (
 run_id uuid PRIMARY KEY,
 environment text NOT NULL, chain_id integer NOT NULL, deployment_digest text NOT NULL,
 source_digest text NOT NULL CHECK(source_digest ~ '^0x[0-9a-f]{64}$'),
 result jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO "{{schema}}".schema_migrations(version) VALUES('0038_display_recovery');
