-- +goose Up
CREATE TABLE tickergarden.maintenance_preparation_queue (
 job_key text PRIMARY KEY REFERENCES tickergarden.maintenance_jobs(job_key),
 generation bigint NOT NULL DEFAULT 0 CHECK(generation>=0),
 failures integer NOT NULL DEFAULT 0 CHECK(failures BETWEEN 0 AND 16),
 due_at timestamptz NOT NULL DEFAULT now(),
 claim_until timestamptz NOT NULL DEFAULT '-infinity',
 checked_at timestamptz,
 status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','not_needed','intent_prepared','unavailable'))
);
CREATE INDEX maintenance_preparation_due ON tickergarden.maintenance_preparation_queue(due_at);
-- +goose Down
DROP TABLE tickergarden.maintenance_preparation_queue;
