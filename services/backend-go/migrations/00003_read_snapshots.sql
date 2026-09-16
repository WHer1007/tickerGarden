-- +goose Up
CREATE TABLE tickergarden.read_snapshots (
 chain_id bigint NOT NULL REFERENCES tickergarden.chain_journal(chain_id),
 revision text NOT NULL,
 block_number bigint NOT NULL CHECK (block_number >= 0),
 block_hash text NOT NULL,
 digest text NOT NULL,
 payload bytea NOT NULL CHECK (octet_length(payload) <= 16777216),
 verified_at timestamptz NOT NULL,
 published_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (chain_id,revision),
 UNIQUE (chain_id,block_number)
);
-- No HTTP writer. The publisher is a separately permissioned process.
-- Keep immutable historical payloads for audit; API exposes the latest 32.
-- +goose Down
DROP TABLE tickergarden.read_snapshots;
