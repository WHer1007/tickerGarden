-- +goose Up
-- NULL denotes an old journal block that must be re-observed, never wall time.
ALTER TABLE tickergarden.chain_blocks ADD COLUMN block_timestamp bigint CHECK(block_timestamp >= 0);
CREATE INDEX chain_blocks_missing_timestamp ON tickergarden.chain_blocks(chain_id,number) WHERE canonical AND block_timestamp IS NULL;
-- +goose Down
DROP INDEX tickergarden.chain_blocks_missing_timestamp;
ALTER TABLE tickergarden.chain_blocks DROP COLUMN block_timestamp;
