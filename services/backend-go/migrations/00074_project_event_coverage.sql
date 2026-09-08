-- +goose Up
ALTER TABLE tickergarden.chain_blocks
 ADD COLUMN event_exclusion_header jsonb,
 ADD COLUMN events_verified boolean GENERATED ALWAYS AS (receipts_verified OR event_exclusion_header IS NOT NULL) STORED,
 ADD CONSTRAINT event_exclusion_shape CHECK (event_exclusion_header IS NULL OR (jsonb_typeof(event_exclusion_header)='object' AND octet_length(event_exclusion_header::text)<=33554432 AND NOT receipts_verified AND receipts_root IS NULL));
CREATE OR REPLACE VIEW tickergarden.canonical_discovered_markets AS
 SELECT m.* FROM tickergarden.discovered_markets m
 JOIN tickergarden.chain_blocks b ON b.chain_id=m.chain_id AND b.hash=m.block_hash
 JOIN tickergarden.chain_journal j ON j.chain_id=b.chain_id
 WHERE b.canonical AND b.events_verified AND b.number<=j.finalized_number;
CREATE OR REPLACE VIEW tickergarden.canonical_projection_rows AS
 SELECT r.* FROM tickergarden.projection_rows r
 JOIN tickergarden.chain_blocks b ON b.chain_id=r.chain_id AND b.hash=r.block_hash
 JOIN tickergarden.projection_checkpoints p ON p.chain_id=r.chain_id
 JOIN tickergarden.chain_blocks tip ON tip.chain_id=p.chain_id AND tip.hash=p.tip_hash
 JOIN tickergarden.chain_journal j ON j.chain_id=r.chain_id
 WHERE b.canonical AND b.events_verified AND tip.canonical AND tip.events_verified
 AND b.number<=p.tip_number AND p.tip_number<=j.finalized_number;
CREATE OR REPLACE VIEW tickergarden.canonical_block_observations AS
 SELECT o.*,b.number AS block_number FROM tickergarden.projection_block_observations o
 JOIN tickergarden.chain_blocks b ON b.chain_id=o.chain_id AND b.hash=o.block_hash
 JOIN tickergarden.projection_checkpoints p ON p.chain_id=o.chain_id
 JOIN tickergarden.chain_blocks tip ON tip.chain_id=p.chain_id AND tip.hash=p.tip_hash
 JOIN tickergarden.chain_journal j ON j.chain_id=o.chain_id
 WHERE b.canonical AND b.events_verified AND tip.canonical AND tip.events_verified
 AND b.number<=p.tip_number AND p.tip_number<=j.finalized_number;
CREATE OR REPLACE VIEW tickergarden.canonical_market_identities AS
 SELECT i.* FROM tickergarden.market_identities i
 JOIN tickergarden.canonical_discovered_markets d USING(chain_id,block_hash,market_id)
 JOIN tickergarden.discovery_checkpoints c ON c.chain_id=i.chain_id AND c.manifest_hash=i.manifest_hash
 JOIN tickergarden.chain_blocks b ON b.chain_id=c.chain_id AND b.hash=c.tip_hash
 JOIN tickergarden.chain_journal j ON j.chain_id=c.chain_id
 WHERE b.canonical AND b.events_verified AND b.number=c.tip_number AND b.number<=j.finalized_number;
CREATE OR REPLACE VIEW tickergarden.canonical_reconciliation_runs AS
 SELECT r.*,b.number AS block_number FROM tickergarden.reconciliation_runs r
 JOIN tickergarden.chain_blocks b ON b.chain_id=r.chain_id AND b.hash=r.block_hash
 JOIN tickergarden.projection_checkpoints p ON p.chain_id=r.chain_id
 JOIN tickergarden.chain_blocks tip ON tip.chain_id=p.chain_id AND tip.hash=p.tip_hash
 JOIN tickergarden.chain_journal j ON j.chain_id=r.chain_id
 WHERE b.canonical AND b.events_verified AND tip.canonical AND tip.events_verified
 AND b.number<=p.tip_number AND p.tip_number<=j.finalized_number;
CREATE OR REPLACE VIEW tickergarden.canonical_event_projection_rows AS
 SELECT r.* FROM tickergarden.event_projection_rows r
 JOIN tickergarden.chain_blocks b ON b.chain_id=r.chain_id AND b.hash=r.block_hash
 JOIN tickergarden.event_projection_checkpoints p ON p.chain_id=r.chain_id
 JOIN tickergarden.chain_blocks tip ON tip.chain_id=p.chain_id AND tip.hash=p.tip_hash
 JOIN tickergarden.chain_journal j ON j.chain_id=r.chain_id
 WHERE b.canonical AND b.events_verified AND tip.canonical AND tip.events_verified
 AND b.number<=p.tip_number AND p.tip_number<=j.finalized_number;
-- +goose Down
CREATE OR REPLACE VIEW tickergarden.canonical_discovered_markets AS
 SELECT m.* FROM tickergarden.discovered_markets m
 JOIN tickergarden.chain_blocks b ON b.chain_id=m.chain_id AND b.hash=m.block_hash
 JOIN tickergarden.chain_journal j ON j.chain_id=b.chain_id
 WHERE b.canonical AND b.receipts_verified AND b.number<=j.finalized_number;
CREATE OR REPLACE VIEW tickergarden.canonical_projection_rows AS
 SELECT r.* FROM tickergarden.projection_rows r
 JOIN tickergarden.chain_blocks b ON b.chain_id=r.chain_id AND b.hash=r.block_hash
 JOIN tickergarden.projection_checkpoints p ON p.chain_id=r.chain_id
 JOIN tickergarden.chain_blocks tip ON tip.chain_id=p.chain_id AND tip.hash=p.tip_hash
 JOIN tickergarden.chain_journal j ON j.chain_id=r.chain_id
 WHERE b.canonical AND b.receipts_verified AND tip.canonical AND tip.receipts_verified
 AND b.number<=p.tip_number AND p.tip_number<=j.finalized_number;
CREATE OR REPLACE VIEW tickergarden.canonical_block_observations AS
 SELECT o.*,b.number AS block_number FROM tickergarden.projection_block_observations o
 JOIN tickergarden.chain_blocks b ON b.chain_id=o.chain_id AND b.hash=o.block_hash
 JOIN tickergarden.projection_checkpoints p ON p.chain_id=o.chain_id
 JOIN tickergarden.chain_blocks tip ON tip.chain_id=p.chain_id AND tip.hash=p.tip_hash
 JOIN tickergarden.chain_journal j ON j.chain_id=o.chain_id
 WHERE b.canonical AND b.receipts_verified AND tip.canonical AND tip.receipts_verified
 AND b.number<=p.tip_number AND p.tip_number<=j.finalized_number;
CREATE OR REPLACE VIEW tickergarden.canonical_market_identities AS
 SELECT i.* FROM tickergarden.market_identities i
 JOIN tickergarden.canonical_discovered_markets d USING(chain_id,block_hash,market_id)
 JOIN tickergarden.discovery_checkpoints c ON c.chain_id=i.chain_id AND c.manifest_hash=i.manifest_hash
 JOIN tickergarden.chain_blocks b ON b.chain_id=c.chain_id AND b.hash=c.tip_hash
 JOIN tickergarden.chain_journal j ON j.chain_id=c.chain_id
 WHERE b.canonical AND b.receipts_verified AND b.number=c.tip_number AND b.number<=j.finalized_number;
CREATE OR REPLACE VIEW tickergarden.canonical_reconciliation_runs AS
 SELECT r.*,b.number AS block_number FROM tickergarden.reconciliation_runs r
 JOIN tickergarden.chain_blocks b ON b.chain_id=r.chain_id AND b.hash=r.block_hash
 JOIN tickergarden.projection_checkpoints p ON p.chain_id=r.chain_id
 JOIN tickergarden.chain_blocks tip ON tip.chain_id=p.chain_id AND tip.hash=p.tip_hash
 JOIN tickergarden.chain_journal j ON j.chain_id=r.chain_id
 WHERE b.canonical AND b.receipts_verified AND tip.canonical AND tip.receipts_verified
 AND b.number<=p.tip_number AND p.tip_number<=j.finalized_number;
CREATE OR REPLACE VIEW tickergarden.canonical_event_projection_rows AS
 SELECT r.* FROM tickergarden.event_projection_rows r
 JOIN tickergarden.chain_blocks b ON b.chain_id=r.chain_id AND b.hash=r.block_hash
 JOIN tickergarden.event_projection_checkpoints p ON p.chain_id=r.chain_id
 JOIN tickergarden.chain_blocks tip ON tip.chain_id=p.chain_id AND tip.hash=p.tip_hash
 JOIN tickergarden.chain_journal j ON j.chain_id=r.chain_id
 WHERE b.canonical AND b.receipts_verified AND tip.canonical AND tip.receipts_verified
 AND b.number<=p.tip_number AND p.tip_number<=j.finalized_number;
ALTER TABLE tickergarden.chain_blocks DROP COLUMN events_verified, DROP COLUMN event_exclusion_header;
