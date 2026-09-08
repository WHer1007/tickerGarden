-- +goose Up
CREATE TABLE tickergarden.settlement_execution_evidence (
 sequence bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 job_key text NOT NULL REFERENCES tickergarden.settlement_submissions(job_key),
 receipt_sequence bigint NOT NULL REFERENCES tickergarden.settlement_receipt_observations(sequence),
 intent_digest text NOT NULL CHECK (intent_digest ~ '^[0-9a-f]{64}$'),
 payload bytea NOT NULL CHECK (octet_length(payload) BETWEEN 1 AND 8388608),
 digest text NOT NULL CHECK (digest ~ '^[0-9a-f]{64}$'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(job_key,receipt_sequence)
);
CREATE INDEX settlement_execution_evidence_job_sequence ON tickergarden.settlement_execution_evidence(job_key,sequence);
-- +goose Down
DROP TABLE tickergarden.settlement_execution_evidence;
