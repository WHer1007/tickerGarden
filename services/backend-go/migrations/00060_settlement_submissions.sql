-- +goose Up
CREATE TABLE tickergarden.settlement_submissions (
 job_key text PRIMARY KEY REFERENCES tickergarden.settlement_sign_requests(job_key),
 intent_digest text NOT NULL CHECK (intent_digest ~ '^[0-9a-f]{64}$'),
 transaction_hash text NOT NULL CHECK (transaction_hash ~ '^0x[0-9a-f]{64}$'),
 check_sequence bigint NOT NULL REFERENCES tickergarden.settlement_checks(sequence),
 authorization_payload bytea NOT NULL CHECK (octet_length(authorization_payload) BETWEEN 1 AND 1048576),
 authorization_digest text NOT NULL CHECK (authorization_digest ~ '^[0-9a-f]{64}$'),
 status text NOT NULL CHECK (status IN ('submission_unknown','acknowledged')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
-- +goose Down
DROP TABLE tickergarden.settlement_submissions;
