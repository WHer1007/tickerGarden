-- +goose Up
CREATE TABLE tickergarden.settlement_receipt_observations (
 sequence bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 job_key text NOT NULL REFERENCES tickergarden.settlement_submissions(job_key),
 payload bytea NOT NULL CHECK (octet_length(payload) BETWEEN 1 AND 65536),
 digest text NOT NULL CHECK (digest ~ '^[0-9a-f]{64}$'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX settlement_receipts_job_sequence ON tickergarden.settlement_receipt_observations(job_key,sequence);
-- +goose Down
DROP TABLE tickergarden.settlement_receipt_observations;
