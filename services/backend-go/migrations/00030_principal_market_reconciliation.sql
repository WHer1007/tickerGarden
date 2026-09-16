-- +goose Up
ALTER TABLE tickergarden.reconciliation_runs DROP CONSTRAINT reconciliation_runs_scope_check;
ALTER TABLE tickergarden.reconciliation_runs ADD CONSTRAINT reconciliation_runs_scope_check CHECK(scope IN ('vault-principal-v1','vault-principal-v2','vault-principal-v3'));
ALTER TABLE tickergarden.reconciliation_probes DROP CONSTRAINT reconciliation_probes_kind_check;
ALTER TABLE tickergarden.reconciliation_probes ADD CONSTRAINT reconciliation_probes_kind_check CHECK(kind IN ('vaultPosition','vaultAllocation','vaultSolvency','vaultMarket'));
ALTER TABLE tickergarden.reconciliation_probes DROP CONSTRAINT reconciliation_probes_field_check;
ALTER TABLE tickergarden.reconciliation_probes ADD CONSTRAINT reconciliation_probes_field_check CHECK(field IN ('deposited','allocated','freeBalanceOf','allocation','totalDeposited','totalAllocated','tokenBalance','marketAllocated'));
-- +goose Down
ALTER TABLE tickergarden.reconciliation_probes DROP CONSTRAINT reconciliation_probes_field_check;
ALTER TABLE tickergarden.reconciliation_probes ADD CONSTRAINT reconciliation_probes_field_check CHECK(field IN ('deposited','allocated','freeBalanceOf','allocation','totalDeposited','totalAllocated','tokenBalance'));
ALTER TABLE tickergarden.reconciliation_probes DROP CONSTRAINT reconciliation_probes_kind_check;
ALTER TABLE tickergarden.reconciliation_probes ADD CONSTRAINT reconciliation_probes_kind_check CHECK(kind IN ('vaultPosition','vaultAllocation','vaultSolvency'));
ALTER TABLE tickergarden.reconciliation_runs DROP CONSTRAINT reconciliation_runs_scope_check;
ALTER TABLE tickergarden.reconciliation_runs ADD CONSTRAINT reconciliation_runs_scope_check CHECK(scope IN ('vault-principal-v1','vault-principal-v2'));
