-- +goose Up
-- Completeness applies only to the named observation scope, never to financial
-- reconciliation. Empty blocks retain an explicit zero-request batch.
CREATE TABLE tickergarden.projection_observation_batches (
 chain_id bigint NOT NULL REFERENCES tickergarden.projection_checkpoints(chain_id),
 block_hash text NOT NULL,
 scope text NOT NULL CHECK(scope='market-curve-v1'),
 expected_count integer NOT NULL CHECK(expected_count>=0),
 completed_count integer NOT NULL CHECK(completed_count=expected_count),
 payload bytea NOT NULL CHECK(octet_length(payload)<=16777216),
 digest text NOT NULL CHECK(digest ~ '^0x[0-9a-f]{64}$'),
 PRIMARY KEY(chain_id,block_hash),
 FOREIGN KEY(chain_id,block_hash) REFERENCES tickergarden.chain_blocks(chain_id,hash)
);
CREATE TABLE tickergarden.projection_block_observations (
 chain_id bigint NOT NULL,
 block_hash text NOT NULL,
 kind text NOT NULL CHECK(kind IN ('market','curve')),
 observation_key text NOT NULL,
 value jsonb NOT NULL CHECK(jsonb_typeof(value)='object'),
 PRIMARY KEY(chain_id,block_hash,kind,observation_key),
 FOREIGN KEY(chain_id,block_hash) REFERENCES tickergarden.projection_observation_batches(chain_id,block_hash)
);
CREATE VIEW tickergarden.canonical_block_observations AS
 SELECT o.*,b.number AS block_number FROM tickergarden.projection_block_observations o
 JOIN tickergarden.chain_blocks b ON b.chain_id=o.chain_id AND b.hash=o.block_hash
 JOIN tickergarden.projection_checkpoints p ON p.chain_id=o.chain_id
 JOIN tickergarden.chain_blocks tip ON tip.chain_id=p.chain_id AND tip.hash=p.tip_hash
 JOIN tickergarden.chain_journal j ON j.chain_id=o.chain_id
 WHERE b.canonical AND b.receipts_verified AND tip.canonical AND tip.receipts_verified
 AND b.number<=p.tip_number AND p.tip_number<=j.finalized_number;
-- +goose Down
DROP VIEW tickergarden.canonical_block_observations;
DROP TABLE tickergarden.projection_block_observations;
DROP TABLE tickergarden.projection_observation_batches;
