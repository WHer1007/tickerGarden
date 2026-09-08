-- +goose Up
ALTER TABLE tickergarden.reconciliation_runs DROP CONSTRAINT reconciliation_runs_scope_check;
ALTER TABLE tickergarden.reconciliation_runs ADD CONSTRAINT reconciliation_runs_scope_check CHECK(scope IN ('vault-principal-v1','vault-principal-v2'));
ALTER TABLE tickergarden.reconciliation_probes ADD COLUMN comparison text NOT NULL DEFAULT 'equal' CHECK(comparison IN ('equal','atLeast'));
ALTER TABLE tickergarden.reconciliation_probes DROP CONSTRAINT reconciliation_probes_kind_check;
ALTER TABLE tickergarden.reconciliation_probes ADD CONSTRAINT reconciliation_probes_kind_check CHECK(kind IN ('vaultPosition','vaultAllocation','vaultSolvency'));
ALTER TABLE tickergarden.reconciliation_probes DROP CONSTRAINT reconciliation_probes_field_check;
ALTER TABLE tickergarden.reconciliation_probes ADD CONSTRAINT reconciliation_probes_field_check CHECK(field IN ('deposited','allocated','freeBalanceOf','allocation','totalDeposited','totalAllocated','tokenBalance'));
ALTER TABLE tickergarden.reconciliation_probes DROP CONSTRAINT reconciliation_probes_check;
ALTER TABLE tickergarden.reconciliation_probes ADD CONSTRAINT reconciliation_probe_result CHECK(
 (status='missing' AND actual_value IS NULL) OR
 (actual_value IS NOT NULL AND (
  (status='matched' AND ((comparison='equal' AND actual_value=expected_value) OR (comparison='atLeast' AND actual_value::numeric>=expected_value::numeric))) OR
  (status='mismatch' AND ((comparison='equal' AND actual_value<>expected_value) OR (comparison='atLeast' AND actual_value::numeric<expected_value::numeric)))
 )));
CREATE OR REPLACE VIEW tickergarden.canonical_reconciliation_probes AS
 SELECT p.* FROM tickergarden.reconciliation_probes p
 JOIN tickergarden.canonical_reconciliation_runs r USING(chain_id,block_hash,scope);
-- +goose Down
DROP VIEW tickergarden.canonical_reconciliation_probes;
-- Evidence is immutable: rebuilding an older projector uses an independent DB.
ALTER TABLE tickergarden.reconciliation_probes DROP CONSTRAINT reconciliation_probe_result;
ALTER TABLE tickergarden.reconciliation_probes ADD CONSTRAINT reconciliation_probes_check CHECK((status='missing' AND actual_value IS NULL) OR (status='matched' AND actual_value IS NOT NULL AND actual_value=expected_value) OR (status='mismatch' AND actual_value IS NOT NULL AND actual_value<>expected_value));
ALTER TABLE tickergarden.reconciliation_probes DROP COLUMN comparison;
ALTER TABLE tickergarden.reconciliation_probes DROP CONSTRAINT reconciliation_probes_kind_check;
ALTER TABLE tickergarden.reconciliation_probes ADD CONSTRAINT reconciliation_probes_kind_check CHECK(kind IN ('vaultPosition','vaultAllocation'));
ALTER TABLE tickergarden.reconciliation_probes DROP CONSTRAINT reconciliation_probes_field_check;
ALTER TABLE tickergarden.reconciliation_probes ADD CONSTRAINT reconciliation_probes_field_check CHECK(field IN ('deposited','allocated','freeBalanceOf','allocation'));
ALTER TABLE tickergarden.reconciliation_runs DROP CONSTRAINT reconciliation_runs_scope_check;
ALTER TABLE tickergarden.reconciliation_runs ADD CONSTRAINT reconciliation_runs_scope_check CHECK(scope='vault-principal-v1');

CREATE VIEW tickergarden.canonical_reconciliation_probes AS
 SELECT p.* FROM tickergarden.reconciliation_probes p
 JOIN tickergarden.canonical_reconciliation_runs r USING(chain_id,block_hash,scope);
