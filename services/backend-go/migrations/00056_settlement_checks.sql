-- +goose Up
CREATE TABLE tickergarden.settlement_checks (
 sequence bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 chain_id bigint NOT NULL CHECK (chain_id IN (4663,46630,421614)),
 genesis_hash text NOT NULL CHECK (genesis_hash ~ '^0x[0-9a-f]{64}$'),
 market_id text NOT NULL CHECK (market_id ~ '^0x[0-9a-f]{64}$'),
 request_digest text NOT NULL CHECK (request_digest ~ '^0x[0-9a-f]{64}$'),
 block_hash text NOT NULL CHECK (block_hash ~ '^0x[0-9a-f]{64}$'),
 digest text NOT NULL UNIQUE CHECK (digest ~ '^[0-9a-f]{64}$'),
 payload bytea NOT NULL CHECK (octet_length(payload) BETWEEN 1 AND 1048576),
 status text NOT NULL DEFAULT 'checked_unsigned' CHECK (status = 'checked_unsigned'),
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX settlement_checks_history ON tickergarden.settlement_checks(chain_id,genesis_hash,market_id,sequence);

-- +goose Down
DROP TABLE tickergarden.settlement_checks;
