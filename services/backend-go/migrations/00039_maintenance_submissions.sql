-- +goose Up
CREATE TABLE tickergarden.maintenance_submissions (
    job_key text PRIMARY KEY REFERENCES tickergarden.maintenance_signed_transactions(job_key),
    intent_digest text NOT NULL CHECK (intent_digest ~ '^0x[0-9a-f]{64}$'),
    transaction_hash text NOT NULL UNIQUE CHECK (transaction_hash ~ '^0x[0-9a-f]{64}$'),
    simulation_digest text NOT NULL,
    status text NOT NULL CHECK (status IN ('submission_unknown','acknowledged')),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    acknowledged_at timestamptz,
    FOREIGN KEY (job_key,simulation_digest) REFERENCES tickergarden.maintenance_simulations(job_key,digest),
    CHECK ((status='acknowledged') = (acknowledged_at IS NOT NULL))
);

-- +goose Down
DROP TABLE tickergarden.maintenance_submissions;
