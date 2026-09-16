-- +goose Up
CREATE TABLE tickergarden.maintenance_signed_transactions (
    job_key text PRIMARY KEY REFERENCES tickergarden.maintenance_transaction_intents(job_key),
    intent_digest text NOT NULL CHECK (intent_digest ~ '^0x[0-9a-f]{64}$'),
    transaction_hash text NOT NULL UNIQUE CHECK (transaction_hash ~ '^0x[0-9a-f]{64}$'),
    raw_transaction bytea NOT NULL CHECK (octet_length(raw_transaction) BETWEEN 1 AND 16384),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

-- +goose Down
DROP TABLE tickergarden.maintenance_signed_transactions;
