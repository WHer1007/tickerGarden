-- +goose Up
CREATE TABLE tickergarden.reconciliation_runs (
 chain_id bigint NOT NULL,
 block_hash text NOT NULL,
 scope text NOT NULL CHECK(scope='vault-principal-v1'),
 expected_count integer NOT NULL CHECK(expected_count>=0),
 completed_count integer NOT NULL CHECK(completed_count>=0 AND completed_count<=expected_count),
 failed_count integer NOT NULL CHECK(failed_count>=0 AND failed_count<=completed_count),
 missing_count integer NOT NULL CHECK(missing_count=expected_count-completed_count),
 payload bytea NOT NULL CHECK(octet_length(payload)<=67108864),
 digest text NOT NULL CHECK(digest ~ '^[0-9a-f]{64}$' AND encode(sha256(payload),'hex')=digest),
 PRIMARY KEY(chain_id,block_hash,scope),
 FOREIGN KEY(chain_id,block_hash) REFERENCES tickergarden.principal_checkpoints(chain_id,block_hash)
);
CREATE TABLE tickergarden.reconciliation_probes (
 chain_id bigint NOT NULL,
 block_hash text NOT NULL,
 scope text NOT NULL,
 ordinal integer NOT NULL CHECK(ordinal>=0),
 kind text NOT NULL CHECK(kind IN ('vaultPosition','vaultAllocation')),
 probe_key text NOT NULL,
 field text NOT NULL CHECK(field IN ('deposited','allocated','freeBalanceOf','allocation')),
 expected_value text NOT NULL CHECK(expected_value ~ '^(0|[1-9][0-9]*)$'),
 actual_value text CHECK(actual_value ~ '^(0|[1-9][0-9]*)$'),
 status text NOT NULL CHECK(status IN ('matched','mismatch','missing')),
 CHECK((status='missing' AND actual_value IS NULL) OR (status='matched' AND actual_value IS NOT NULL AND actual_value=expected_value) OR (status='mismatch' AND actual_value IS NOT NULL AND actual_value<>expected_value)),
 PRIMARY KEY(chain_id,block_hash,scope,ordinal),
 UNIQUE(chain_id,block_hash,scope,kind,probe_key,field),
 FOREIGN KEY(chain_id,block_hash,scope) REFERENCES tickergarden.reconciliation_runs(chain_id,block_hash,scope)
);
CREATE TRIGGER reconciliation_run_immutable BEFORE UPDATE OR DELETE ON tickergarden.reconciliation_runs FOR EACH ROW EXECUTE FUNCTION tickergarden.reject_treasury_audit_mutation();
CREATE TRIGGER reconciliation_probe_immutable BEFORE UPDATE OR DELETE ON tickergarden.reconciliation_probes FOR EACH ROW EXECUTE FUNCTION tickergarden.reject_treasury_audit_mutation();
CREATE VIEW tickergarden.canonical_reconciliation_runs AS
 SELECT r.*,b.number AS block_number FROM tickergarden.reconciliation_runs r
 JOIN tickergarden.chain_blocks b ON b.chain_id=r.chain_id AND b.hash=r.block_hash
 JOIN tickergarden.projection_checkpoints p ON p.chain_id=r.chain_id
 JOIN tickergarden.chain_blocks tip ON tip.chain_id=p.chain_id AND tip.hash=p.tip_hash
 JOIN tickergarden.chain_journal j ON j.chain_id=r.chain_id
 WHERE b.canonical AND b.receipts_verified AND tip.canonical AND tip.receipts_verified
 AND b.number<=p.tip_number AND p.tip_number<=j.finalized_number;
CREATE VIEW tickergarden.canonical_reconciliation_probes AS
 SELECT p.* FROM tickergarden.reconciliation_probes p
 JOIN tickergarden.canonical_reconciliation_runs r USING(chain_id,block_hash,scope);
-- +goose Down
DROP VIEW tickergarden.canonical_reconciliation_probes;
DROP VIEW tickergarden.canonical_reconciliation_runs;
DROP TABLE tickergarden.reconciliation_probes;
DROP TABLE tickergarden.reconciliation_runs;
