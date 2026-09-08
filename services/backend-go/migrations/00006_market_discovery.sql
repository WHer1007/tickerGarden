-- +goose Up
CREATE TABLE tickergarden.discovery_checkpoints (
 chain_id bigint PRIMARY KEY REFERENCES tickergarden.chain_journal(chain_id),
 manifest_hash text NOT NULL CHECK (manifest_hash ~ '^0x[0-9a-f]{64}$'),
 start_block bigint NOT NULL CHECK (start_block >= 0),
 tip_number bigint,
 tip_hash text,
 updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK ((tip_number IS NULL) = (tip_hash IS NULL)),
 CHECK (tip_number IS NULL OR tip_number >= start_block),
 FOREIGN KEY (chain_id,tip_hash) REFERENCES tickergarden.chain_blocks(chain_id,hash)
);
CREATE TABLE tickergarden.discovery_batches (
 chain_id bigint NOT NULL REFERENCES tickergarden.discovery_checkpoints(chain_id),
 block_hash text NOT NULL,
 observed_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (chain_id,block_hash),
 FOREIGN KEY (chain_id,block_hash) REFERENCES tickergarden.chain_blocks(chain_id,hash)
);
CREATE TABLE tickergarden.discovered_markets (
 chain_id bigint NOT NULL,
 block_hash text NOT NULL,
 market_id text NOT NULL CHECK (market_id ~ '^0x[0-9a-f]{64}$'),
 log_index bigint NOT NULL,
 payload jsonb NOT NULL CHECK (jsonb_typeof(payload)='object' AND octet_length(payload::text)<=16777216),
 PRIMARY KEY (chain_id,block_hash,market_id),
 UNIQUE (chain_id,block_hash,log_index),
 FOREIGN KEY (chain_id,block_hash) REFERENCES tickergarden.discovery_batches(chain_id,block_hash),
 FOREIGN KEY (chain_id,block_hash,log_index) REFERENCES tickergarden.chain_logs(chain_id,block_hash,log_index)
);
CREATE INDEX discovered_markets_identity ON tickergarden.discovered_markets(chain_id,market_id);
-- Consumers must use this view: retained history is not canonical discovery.
CREATE VIEW tickergarden.canonical_discovered_markets AS
 SELECT m.* FROM tickergarden.discovered_markets m
 JOIN tickergarden.chain_blocks b ON b.chain_id=m.chain_id AND b.hash=m.block_hash
 JOIN tickergarden.chain_journal j ON j.chain_id=b.chain_id
 WHERE b.canonical AND b.receipts_verified AND b.number<=j.finalized_number;
-- +goose Down
DROP VIEW tickergarden.canonical_discovered_markets;
DROP TABLE tickergarden.discovered_markets;
DROP TABLE tickergarden.discovery_batches;
DROP TABLE tickergarden.discovery_checkpoints;
