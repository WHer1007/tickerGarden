-- +goose Up
CREATE TABLE tickergarden.treasury_request_discovery (
 chain_id bigint NOT NULL,
 manifest_hash text NOT NULL CHECK(manifest_hash ~ '^0x[0-9a-f]{64}$'),
 block_hash text NOT NULL,
 log_index bigint NOT NULL,
 observed_hash text NOT NULL,
 policy_set_hash text NOT NULL CHECK(policy_set_hash ~ '^0x[0-9a-f]{64}$'),
 state text NOT NULL CHECK(state IN ('queued','inactive','awaiting_policy')),
 job_id text REFERENCES tickergarden.treasury_jobs(id),
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(chain_id,manifest_hash,block_hash,log_index),
 FOREIGN KEY(chain_id,block_hash,log_index) REFERENCES tickergarden.chain_logs(chain_id,block_hash,log_index),
 FOREIGN KEY(chain_id,observed_hash) REFERENCES tickergarden.chain_blocks(chain_id,hash),
 CHECK ((state='queued') = (job_id IS NOT NULL))
);
-- +goose Down
DROP TABLE tickergarden.treasury_request_discovery;
