-- Operational coverage is separate from a readable persisted chain snapshot.
CREATE TABLE "{{schema}}".display_health (
 environment text NOT NULL, chain_id integer NOT NULL, deployment_digest text NOT NULL,
 status text NOT NULL CHECK(status='gap'), reason text NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(environment,chain_id,deployment_digest)
);
INSERT INTO "{{schema}}".schema_migrations(version) VALUES('0037_display_health');
