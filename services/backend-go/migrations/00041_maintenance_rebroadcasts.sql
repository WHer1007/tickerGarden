-- +goose Up
CREATE TABLE tickergarden.maintenance_rebroadcasts (
 job_key text NOT NULL REFERENCES tickergarden.maintenance_submissions(job_key),
 attempt_id text NOT NULL CHECK (attempt_id ~ '^0x[0-9a-f]{64}$'),
 transaction_hash text NOT NULL CHECK (transaction_hash ~ '^0x[0-9a-f]{64}$'),
 simulation_digest text NOT NULL,
 status text NOT NULL CHECK (status IN ('submission_unknown','acknowledged')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(job_key,attempt_id),
 FOREIGN KEY(job_key,simulation_digest) REFERENCES tickergarden.maintenance_simulations(job_key,digest)
);
-- +goose Down
DROP TABLE tickergarden.maintenance_rebroadcasts;
