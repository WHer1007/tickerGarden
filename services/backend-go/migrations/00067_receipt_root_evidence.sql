-- +goose Up
ALTER TABLE tickergarden.chain_blocks
 ADD COLUMN receipts_root text CHECK (receipts_root ~ '^0x[0-9a-f]{64}$'),
 ADD COLUMN root_receipt_set_hash text,
 ADD CONSTRAINT receipt_root_evidence CHECK (
  (receipts_root IS NULL AND root_receipt_set_hash IS NULL) OR
  (receipts_root IS NOT NULL AND root_receipt_set_hash IS NOT NULL AND
   receipt_set_hash IS NOT NULL AND root_receipt_set_hash = receipt_set_hash)
 );
-- Existing blocks remain unproven until re-observed. Evidence is scoped to the
-- full header hash and exact simplified receipt set, not independent consensus.
CREATE INDEX chain_blocks_missing_receipt_root ON tickergarden.chain_blocks(chain_id,number)
 WHERE canonical AND receipts_root IS NULL;
-- +goose Down
DROP INDEX tickergarden.chain_blocks_missing_receipt_root;
ALTER TABLE tickergarden.chain_blocks DROP CONSTRAINT receipt_root_evidence,
 DROP COLUMN root_receipt_set_hash, DROP COLUMN receipts_root;
