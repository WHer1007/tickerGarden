-- +goose Up
CREATE TABLE tickergarden.maintenance_gas_observations (
 sequence bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 job_key text NOT NULL REFERENCES tickergarden.maintenance_submissions(job_key),
 receipt_sequence bigint NOT NULL,
 payload bytea NOT NULL CHECK(octet_length(payload) BETWEEN 1 AND 16384),
 digest text NOT NULL CHECK(digest ~ '^0x[0-9a-f]{64}$'),
 observed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(job_key,receipt_sequence) REFERENCES tickergarden.maintenance_receipt_observations(job_key,sequence)
);
CREATE INDEX maintenance_gas_observations_job_sequence ON tickergarden.maintenance_gas_observations(job_key,sequence);
-- +goose Down
DROP TABLE tickergarden.maintenance_gas_observations;
