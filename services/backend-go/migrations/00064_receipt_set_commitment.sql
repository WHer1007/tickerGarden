-- +goose Up
ALTER TABLE tickergarden.chain_blocks
 ADD COLUMN receipt_count integer CHECK (receipt_count BETWEEN 0 AND 16384),
 ADD COLUMN receipt_set_hash text CHECK (receipt_set_hash ~ '^sha256:[0-9a-f]{64}$'),
 ADD CONSTRAINT receipt_set_pair CHECK ((receipt_count IS NULL) = (receipt_set_hash IS NULL));
-- Existing observations remain uncommitted until the indexer re-observes them.
-- +goose Down
ALTER TABLE tickergarden.chain_blocks DROP CONSTRAINT receipt_set_pair,
 DROP COLUMN receipt_count, DROP COLUMN receipt_set_hash;
