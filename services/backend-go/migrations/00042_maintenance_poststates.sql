-- +goose Up
ALTER TABLE tickergarden.maintenance_receipt_observations ADD CONSTRAINT maintenance_receipt_job_sequence_key UNIQUE(job_key,sequence);
CREATE TABLE tickergarden.maintenance_poststates (
 sequence bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 job_key text NOT NULL REFERENCES tickergarden.maintenance_submissions(job_key),
 receipt_sequence bigint NOT NULL,
 payload bytea NOT NULL CHECK (octet_length(payload) BETWEEN 1 AND 65536),
 digest text NOT NULL CHECK (digest ~ '^0x[0-9a-f]{64}$'),
 verified_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(job_key,receipt_sequence) REFERENCES tickergarden.maintenance_receipt_observations(job_key,sequence)
);
-- +goose Down
DROP TABLE tickergarden.maintenance_poststates;
ALTER TABLE tickergarden.maintenance_receipt_observations DROP CONSTRAINT maintenance_receipt_job_sequence_key;
