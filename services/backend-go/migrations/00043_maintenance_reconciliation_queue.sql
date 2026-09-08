-- +goose Up
CREATE TABLE tickergarden.maintenance_reconciliation_queue (
 job_key text PRIMARY KEY REFERENCES tickergarden.maintenance_submissions(job_key),
 generation bigint NOT NULL DEFAULT 0 CHECK (generation>=0),
 claim_until timestamptz NOT NULL DEFAULT '-infinity',
 due_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','not_observed','mined_success','mined_reverted','finalized_reverted','poststate_unmet','verified_complete','unavailable')),
 failures integer NOT NULL DEFAULT 0 CHECK(failures BETWEEN 0 AND 16),
 receipt_sequence bigint REFERENCES tickergarden.maintenance_receipt_observations(sequence),
 poststate_sequence bigint REFERENCES tickergarden.maintenance_poststates(sequence),
 checked_at timestamptz
);
CREATE INDEX maintenance_reconciliation_due ON tickergarden.maintenance_reconciliation_queue(due_at,job_key);
-- +goose Down
DROP TABLE tickergarden.maintenance_reconciliation_queue;
