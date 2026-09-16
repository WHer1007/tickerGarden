-- +goose Up
-- A terminal receipt releases only the off-chain maximum gas reservation.
-- It does not delete signed intents, recycle nonces or establish execution success.
CREATE TABLE tickergarden.settlement_reservation_releases (
 job_key text PRIMARY KEY REFERENCES tickergarden.settlement_intents(job_key),
 receipt_sequence bigint NOT NULL REFERENCES tickergarden.settlement_receipt_observations(sequence),
 receipt_digest text NOT NULL,
 transaction_hash text NOT NULL CHECK (transaction_hash ~ '^0x[0-9a-f]{64}$'),
 block_hash text NOT NULL CHECK (block_hash ~ '^0x[0-9a-f]{64}$'),
 status text NOT NULL CHECK (status IN ('finalized_success','finalized_reverted')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
-- +goose Down
DROP TABLE tickergarden.settlement_reservation_releases;
