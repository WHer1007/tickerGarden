-- +goose Up
-- Old journal rows are explicitly unverified; no migration invents receipts.
ALTER TABLE tickergarden.chain_blocks ADD COLUMN receipts_verified boolean NOT NULL DEFAULT false;
CREATE INDEX chain_blocks_receipt_backfill ON tickergarden.chain_blocks(chain_id,number) WHERE canonical AND NOT receipts_verified;
CREATE TABLE tickergarden.chain_receipts (
 chain_id bigint NOT NULL,
 block_hash text NOT NULL,
 transaction_hash text NOT NULL,
 transaction_index bigint NOT NULL CHECK (transaction_index >= 0),
 status text NOT NULL CHECK (status IN ('0x0','0x1')),
 payload jsonb NOT NULL,
 PRIMARY KEY (chain_id,block_hash,transaction_hash),
 UNIQUE (chain_id,block_hash,transaction_index),
 FOREIGN KEY(chain_id,block_hash) REFERENCES tickergarden.chain_blocks(chain_id,hash)
);
CREATE INDEX chain_receipts_transaction ON tickergarden.chain_receipts(chain_id,transaction_hash);
-- +goose Down
DROP TABLE tickergarden.chain_receipts;
DROP INDEX tickergarden.chain_blocks_receipt_backfill;
ALTER TABLE tickergarden.chain_blocks DROP COLUMN receipts_verified;
