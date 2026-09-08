-- +goose Up
CREATE TABLE tickergarden.projection_checkpoints (
 chain_id bigint PRIMARY KEY REFERENCES tickergarden.discovery_checkpoints(chain_id),
 manifest_hash text NOT NULL,
 projector_version text NOT NULL,
 start_block bigint NOT NULL CHECK(start_block>=0),
 tip_number bigint,
 tip_hash text,
 input_count bigint NOT NULL DEFAULT 0 CHECK(input_count>=0),
 updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK ((tip_number IS NULL)=(tip_hash IS NULL)),
 CHECK (tip_number IS NULL OR tip_number>=start_block),
 FOREIGN KEY(chain_id,tip_hash) REFERENCES tickergarden.chain_blocks(chain_id,hash)
);
CREATE TABLE tickergarden.projection_inputs (
 chain_id bigint NOT NULL REFERENCES tickergarden.projection_checkpoints(chain_id),
 block_hash text NOT NULL,
 log_index bigint NOT NULL,
 payload bytea NOT NULL CHECK(octet_length(payload)<=16777216),
 digest text NOT NULL CHECK(digest ~ '^0x[0-9a-f]{64}$'),
 PRIMARY KEY(chain_id,block_hash,log_index),
 FOREIGN KEY(chain_id,block_hash,log_index) REFERENCES tickergarden.chain_logs(chain_id,block_hash,log_index)
);
CREATE TABLE tickergarden.projection_rows (
 chain_id bigint NOT NULL REFERENCES tickergarden.projection_checkpoints(chain_id),
 table_name text NOT NULL CHECK(table_name IN ('events','configs','markets','pools','poolEvents','curveTrades','stockPositions','allocations','activationBuckets','gaugePositions','rewardExits','feeCredits','feeClaims','swaps','observations')),
 row_key text NOT NULL,
 payload jsonb NOT NULL CHECK(jsonb_typeof(payload)='object'),
 block_hash text NOT NULL,
 PRIMARY KEY(chain_id,table_name,row_key),
 FOREIGN KEY(chain_id,block_hash) REFERENCES tickergarden.chain_blocks(chain_id,hash)
);
CREATE VIEW tickergarden.canonical_projection_rows AS
 SELECT r.* FROM tickergarden.projection_rows r
 JOIN tickergarden.chain_blocks b ON b.chain_id=r.chain_id AND b.hash=r.block_hash
 JOIN tickergarden.projection_checkpoints p ON p.chain_id=r.chain_id
 JOIN tickergarden.chain_blocks tip ON tip.chain_id=p.chain_id AND tip.hash=p.tip_hash
 JOIN tickergarden.chain_journal j ON j.chain_id=r.chain_id
 WHERE b.canonical AND b.receipts_verified AND tip.canonical AND tip.receipts_verified
 AND b.number<=p.tip_number AND p.tip_number<=j.finalized_number;
-- +goose Down
DROP VIEW tickergarden.canonical_projection_rows;
DROP TABLE tickergarden.projection_rows;
DROP TABLE tickergarden.projection_inputs;
DROP TABLE tickergarden.projection_checkpoints;
