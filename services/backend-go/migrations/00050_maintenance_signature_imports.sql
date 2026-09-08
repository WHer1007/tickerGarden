-- +goose Up
CREATE TABLE tickergarden.maintenance_signature_imports (
 job_key text PRIMARY KEY REFERENCES tickergarden.maintenance_sign_requests(job_key),
 intent_digest text NOT NULL CHECK(intent_digest ~ '^0x[0-9a-f]{64}$'),
 transaction_hash text NOT NULL CHECK(transaction_hash ~ '^0x[0-9a-f]{64}$'),
 imported_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 imported_by text NOT NULL DEFAULT session_user
);
-- +goose Down
DROP TABLE tickergarden.maintenance_signature_imports;
