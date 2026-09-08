-- +goose Up
CREATE TABLE tickergarden.maintenance_work_scopes (
 scope_key text PRIMARY KEY CHECK(scope_key ~ '^0x[0-9a-f]{64}$'),
 scope_payload bytea NOT NULL CHECK(octet_length(scope_payload) BETWEEN 1 AND 4096),
 generation bigint NOT NULL DEFAULT 0 CHECK(generation>=0),
 active_job_key text REFERENCES tickergarden.maintenance_jobs(job_key),
 CHECK((generation=0)=(active_job_key IS NULL))
);
-- +goose Down
DROP TABLE tickergarden.maintenance_work_scopes;
