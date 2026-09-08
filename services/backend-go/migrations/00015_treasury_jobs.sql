-- +goose Up
CREATE TABLE tickergarden.treasury_jobs (
 id text PRIMARY KEY CHECK(id ~ '^0x[0-9a-f]{64}$'),
 chain_id bigint NOT NULL REFERENCES tickergarden.chain_journal(chain_id),
 manifest_hash text NOT NULL CHECK(manifest_hash ~ '^0x[0-9a-f]{64}$'),
 payload bytea NOT NULL CHECK(octet_length(payload) <= 17825792),
 state text NOT NULL DEFAULT 'ready' CHECK(state IN ('ready','running','succeeded','dead')),
 attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 5),
 available_at timestamptz NOT NULL DEFAULT now(),
 lease_token text,
 lease_until timestamptz,
 candidate_id text REFERENCES tickergarden.treasury_candidates(id),
 error_code text NOT NULL DEFAULT '' CHECK(error_code IN ('','processing_failed','lease_exhausted','invalid_payload')),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK ((state='running') = (lease_token IS NOT NULL AND lease_until IS NOT NULL)),
 CHECK (state='running' OR (lease_token IS NULL AND lease_until IS NULL)),
 CHECK ((state='succeeded') = (candidate_id IS NOT NULL))
);
CREATE INDEX treasury_jobs_pending ON tickergarden.treasury_jobs(chain_id,manifest_hash,available_at,created_at) WHERE state IN ('ready','running');
-- +goose Down
DROP TABLE tickergarden.treasury_jobs;
