-- +goose Up
CREATE TABLE tickergarden.maintenance_receipt_observations (
 sequence bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 job_key text NOT NULL REFERENCES tickergarden.maintenance_submissions(job_key),
 payload bytea NOT NULL CHECK (octet_length(payload) BETWEEN 1 AND 65536),
 digest text NOT NULL CHECK (digest ~ '^0x[0-9a-f]{64}$'),
 observed_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX maintenance_receipt_observations_job_sequence ON tickergarden.maintenance_receipt_observations(job_key,sequence DESC);
-- +goose Down
DROP TABLE tickergarden.maintenance_receipt_observations;
