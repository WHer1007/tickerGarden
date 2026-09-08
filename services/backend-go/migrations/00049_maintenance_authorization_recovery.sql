-- +goose Up
CREATE TABLE tickergarden.maintenance_authorization_recoveries (
 job_key text NOT NULL,
 recovery_id text NOT NULL CHECK(recovery_id ~ '^0x[0-9a-f]{64}$'),
 generation bigint NOT NULL,
 intent_digest text NOT NULL CHECK(intent_digest ~ '^0x[0-9a-f]{64}$'),
 simulation_digest text NOT NULL,
 expires_at timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(job_key,recovery_id),
 FOREIGN KEY(job_key,generation) REFERENCES tickergarden.maintenance_leases(job_key,generation),
 FOREIGN KEY(job_key,simulation_digest) REFERENCES tickergarden.maintenance_simulations(job_key,digest)
);
-- +goose Down
DROP TABLE tickergarden.maintenance_authorization_recoveries;
