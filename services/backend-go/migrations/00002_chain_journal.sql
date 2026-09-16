-- +goose Up
CREATE TABLE tickergarden.chain_journal (
 chain_id bigint PRIMARY KEY CHECK (chain_id IN (4663,46630)),
 genesis_hash text NOT NULL,
 start_block bigint NOT NULL CHECK (start_block >= 0),
 tip_number bigint,
 tip_hash text,
 finalized_number bigint,
 finalized_hash text,
 updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK ((tip_number IS NULL) = (tip_hash IS NULL)),
 CHECK ((finalized_number IS NULL) = (finalized_hash IS NULL))
);
CREATE TABLE tickergarden.chain_blocks (
 chain_id bigint NOT NULL REFERENCES tickergarden.chain_journal(chain_id),
 number bigint NOT NULL CHECK (number >= 0),
 hash text NOT NULL,
 parent_hash text NOT NULL,
 canonical boolean NOT NULL DEFAULT true,
 observed_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (chain_id, hash)
);
CREATE UNIQUE INDEX chain_blocks_canonical_height ON tickergarden.chain_blocks(chain_id, number) WHERE canonical;
CREATE TABLE tickergarden.chain_logs (
 chain_id bigint NOT NULL,
 block_hash text NOT NULL,
 log_index bigint NOT NULL CHECK (log_index >= 0),
 address text NOT NULL,
 payload jsonb NOT NULL,
 PRIMARY KEY (chain_id, block_hash, log_index),
 FOREIGN KEY (chain_id, block_hash) REFERENCES tickergarden.chain_blocks(chain_id, hash)
);
CREATE INDEX chain_logs_address ON tickergarden.chain_logs(chain_id, address);
-- +goose Down
DROP TABLE tickergarden.chain_logs;
DROP TABLE tickergarden.chain_blocks;
DROP TABLE tickergarden.chain_journal;
