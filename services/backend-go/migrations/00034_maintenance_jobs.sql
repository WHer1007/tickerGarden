-- +goose Up
CREATE TABLE tickergarden.maintenance_jobs (
    job_key text PRIMARY KEY CHECK (job_key ~ '^0x[0-9a-f]{64}$'),
    intent_digest text NOT NULL UNIQUE CHECK (intent_digest ~ '^0x[0-9a-f]{64}$'),
    chain_id bigint NOT NULL CHECK (chain_id IN (4663,46630,421614)),
    identity_payload bytea NOT NULL CHECK (octet_length(identity_payload) <= 4096),
    identity_digest text NOT NULL CHECK (identity_digest ~ '^0x[0-9a-f]{64}$'),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE tickergarden.maintenance_simulations (
    sequence bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    job_key text NOT NULL REFERENCES tickergarden.maintenance_jobs(job_key),
    payload bytea NOT NULL CHECK (octet_length(payload) <= 16384),
    digest text NOT NULL CHECK (digest ~ '^0x[0-9a-f]{64}$'),
    recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    UNIQUE (job_key,digest)
);
CREATE INDEX maintenance_simulations_job_sequence ON tickergarden.maintenance_simulations(job_key,sequence);

-- +goose Down
DROP TABLE tickergarden.maintenance_simulations;
DROP TABLE tickergarden.maintenance_jobs;
