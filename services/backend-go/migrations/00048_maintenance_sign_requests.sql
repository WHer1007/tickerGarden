-- +goose Up
CREATE TABLE tickergarden.maintenance_sign_requests (
 job_key text PRIMARY KEY REFERENCES tickergarden.maintenance_jobs(job_key),
 intent_digest text NOT NULL CHECK(intent_digest ~ '^0x[0-9a-f]{64}$'),
 generation bigint NOT NULL,
 requested_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 raw_transaction bytea CHECK(octet_length(raw_transaction) BETWEEN 1 AND 16384),
 FOREIGN KEY(job_key,generation) REFERENCES tickergarden.maintenance_leases(job_key,generation)
);
-- +goose Down
DROP TABLE tickergarden.maintenance_sign_requests;
