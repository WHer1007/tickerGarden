-- +goose Up
-- Supports canonical block joins and the chain_blocks foreign-key check during
-- history deletion; avoid scanning all projection pages once for each block.
CREATE INDEX projection_rows_block_lookup ON tickergarden.projection_rows(chain_id,block_hash);
-- +goose Down
DROP INDEX tickergarden.projection_rows_block_lookup;
