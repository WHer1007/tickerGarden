-- +goose Up
ALTER TABLE tickergarden.maintenance_gas_observations ADD CONSTRAINT maintenance_gas_receipt_sequence_key UNIQUE(job_key,receipt_sequence,sequence);
ALTER TABLE tickergarden.maintenance_reconciliation_queue
 ADD COLUMN gas_status text NOT NULL DEFAULT 'not_checked' CHECK(gas_status IN ('not_checked','not_finalized','recorded','unavailable')),
 ADD COLUMN gas_sequence bigint,
 ADD COLUMN gas_failures integer NOT NULL DEFAULT 0 CHECK(gas_failures BETWEEN 0 AND 16),
 ADD CONSTRAINT maintenance_reconciliation_gas_state CHECK((gas_status='recorded')=(gas_sequence IS NOT NULL) AND (gas_sequence IS NULL OR receipt_sequence IS NOT NULL)),
 ADD CONSTRAINT maintenance_reconciliation_gas_source FOREIGN KEY(job_key,receipt_sequence,gas_sequence) REFERENCES tickergarden.maintenance_gas_observations(job_key,receipt_sequence,sequence);
-- +goose Down
ALTER TABLE tickergarden.maintenance_reconciliation_queue DROP CONSTRAINT maintenance_reconciliation_gas_source,DROP CONSTRAINT maintenance_reconciliation_gas_state,DROP COLUMN gas_status,DROP COLUMN gas_sequence,DROP COLUMN gas_failures;
ALTER TABLE tickergarden.maintenance_gas_observations DROP CONSTRAINT maintenance_gas_receipt_sequence_key;
