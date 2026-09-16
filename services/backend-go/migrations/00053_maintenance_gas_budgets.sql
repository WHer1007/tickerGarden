-- +goose Up
CREATE TABLE tickergarden.maintenance_gas_budgets (
 chain_id bigint NOT NULL, genesis_hash text NOT NULL, sender text NOT NULL,
 revision bigint NOT NULL DEFAULT 0 CHECK(revision>=0),
 max_transaction numeric(78,0) NOT NULL CHECK(max_transaction>0),
 maximum_total numeric(78,0) NOT NULL CHECK(maximum_total>0),
 allocated numeric(78,0) NOT NULL DEFAULT 0 CHECK(allocated>=0 AND allocated<=maximum_total),
 PRIMARY KEY(chain_id,genesis_hash,sender)
);
CREATE TABLE tickergarden.maintenance_gas_budget_changes (
 chain_id bigint NOT NULL, genesis_hash text NOT NULL, sender text NOT NULL, request_id text NOT NULL,
 revision bigint NOT NULL, max_transaction numeric(78,0) NOT NULL, maximum_total numeric(78,0) NOT NULL,
 allocated numeric(78,0) NOT NULL, changed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 changed_by text NOT NULL DEFAULT session_user,
 PRIMARY KEY(chain_id,genesis_hash,sender,request_id),
 UNIQUE(chain_id,genesis_hash,sender,revision),
 FOREIGN KEY(chain_id,genesis_hash,sender) REFERENCES tickergarden.maintenance_gas_budgets
);
CREATE TABLE tickergarden.maintenance_gas_budget_charges (
 job_key text PRIMARY KEY REFERENCES tickergarden.maintenance_submissions(job_key),
 chain_id bigint NOT NULL, genesis_hash text NOT NULL, sender text NOT NULL,
 revision bigint NOT NULL, maximum_gas_cost numeric(78,0) NOT NULL CHECK(maximum_gas_cost>0),
 charged_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(chain_id,genesis_hash,sender,revision) REFERENCES tickergarden.maintenance_gas_budget_changes(chain_id,genesis_hash,sender,revision)
);
ALTER TABLE tickergarden.maintenance_submission_queue DROP CONSTRAINT maintenance_submission_queue_status_check;
ALTER TABLE tickergarden.maintenance_submission_queue ADD CHECK(status IN ('queued','acknowledged','submission_unknown','authorization_required','unavailable','budget_required','budget_exceeded'));
-- +goose Down
UPDATE tickergarden.maintenance_submission_queue SET status='unavailable' WHERE status IN ('budget_required','budget_exceeded');
ALTER TABLE tickergarden.maintenance_submission_queue DROP CONSTRAINT maintenance_submission_queue_status_check;
ALTER TABLE tickergarden.maintenance_submission_queue ADD CHECK(status IN ('queued','acknowledged','submission_unknown','authorization_required','unavailable'));
DROP TABLE tickergarden.maintenance_gas_budget_charges;
DROP TABLE tickergarden.maintenance_gas_budget_changes;
DROP TABLE tickergarden.maintenance_gas_budgets;
