-- +goose Up
CREATE TABLE tickergarden.settlement_sign_requests (
 job_key text PRIMARY KEY REFERENCES tickergarden.settlement_intents(job_key),
 intent_digest text NOT NULL CHECK (intent_digest ~ '^[0-9a-f]{64}$'),
 check_sequence bigint NOT NULL REFERENCES tickergarden.settlement_checks(sequence),
 request_payload bytea NOT NULL CHECK (octet_length(request_payload) BETWEEN 1 AND 1048576),
 request_digest text NOT NULL CHECK (request_digest ~ '^[0-9a-f]{64}$'),
 raw_transaction bytea CHECK (octet_length(raw_transaction) BETWEEN 1 AND 16384),
 transaction_hash text CHECK (transaction_hash ~ '^0x[0-9a-f]{64}$'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK ((raw_transaction IS NULL) = (transaction_hash IS NULL))
);

-- +goose Down
DROP TABLE tickergarden.settlement_sign_requests;
