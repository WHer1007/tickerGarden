-- +goose Up
CREATE TABLE tickergarden.market_identities (
 chain_id bigint NOT NULL,
 block_hash text NOT NULL,
 market_id text NOT NULL,
 manifest_hash text NOT NULL CHECK(manifest_hash ~ '^0x[0-9a-f]{64}$'),
 payload bytea NOT NULL CHECK(octet_length(payload)<=262144),
 digest text NOT NULL CHECK(digest ~ '^[0-9a-f]{64}$' AND encode(sha256(payload),'hex')=digest),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(chain_id,block_hash,market_id),
 FOREIGN KEY(chain_id,block_hash,market_id) REFERENCES tickergarden.discovered_markets(chain_id,block_hash,market_id)
);
CREATE TRIGGER market_identity_immutable BEFORE UPDATE OR DELETE ON tickergarden.market_identities FOR EACH ROW EXECUTE FUNCTION tickergarden.reject_treasury_audit_mutation();
CREATE VIEW tickergarden.canonical_market_identities AS
 SELECT i.* FROM tickergarden.market_identities i
 JOIN tickergarden.canonical_discovered_markets d USING(chain_id,block_hash,market_id)
 JOIN tickergarden.discovery_checkpoints c ON c.chain_id=i.chain_id AND c.manifest_hash=i.manifest_hash
 JOIN tickergarden.chain_blocks b ON b.chain_id=c.chain_id AND b.hash=c.tip_hash
 JOIN tickergarden.chain_journal j ON j.chain_id=c.chain_id
 WHERE b.canonical AND b.receipts_verified AND b.number=c.tip_number AND b.number<=j.finalized_number;
-- +goose Down
DROP VIEW tickergarden.canonical_market_identities;
DROP TABLE tickergarden.market_identities;
