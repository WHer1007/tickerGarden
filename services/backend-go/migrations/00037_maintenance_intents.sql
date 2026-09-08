-- +goose Up
CREATE TABLE tickergarden.maintenance_transaction_intents (
    job_key text PRIMARY KEY REFERENCES tickergarden.maintenance_nonce_reservations(job_key),
    payload bytea NOT NULL CHECK (octet_length(payload) <= 16384),
    digest text NOT NULL CHECK (digest ~ '^0x[0-9a-f]{64}$'),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

-- +goose Down
DROP TABLE tickergarden.maintenance_transaction_intents;
