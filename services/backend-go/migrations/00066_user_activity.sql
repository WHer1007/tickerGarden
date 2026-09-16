-- +goose Up
CREATE TABLE tickergarden.user_activity_blocks (
 chain_id bigint NOT NULL,
 block_hash text NOT NULL,
 manifest_hash text NOT NULL CHECK (manifest_hash ~ '^0x[0-9a-f]{64}$'),
 extractor_version text NOT NULL,
 receipt_set_hash text NOT NULL CHECK (receipt_set_hash ~ '^sha256:[0-9a-f]{64}$'),
 record_count integer NOT NULL CHECK(record_count BETWEEN 0 AND 100000),
 records_hash text NOT NULL CHECK (records_hash ~ '^sha256:[0-9a-f]{64}$'),
 indexed_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(chain_id,block_hash),
 FOREIGN KEY(chain_id,block_hash) REFERENCES tickergarden.chain_blocks(chain_id,hash) ON DELETE CASCADE
);
CREATE TABLE tickergarden.user_activity_records (
 chain_id bigint NOT NULL,
 block_hash text NOT NULL,
 account text NOT NULL CHECK(account ~ '^0x[0-9a-f]{40}$' AND account <> '0x0000000000000000000000000000000000000000'),
 block_number bigint NOT NULL CHECK(block_number>=0),
 transaction_index bigint NOT NULL CHECK(transaction_index>=0),
 log_index bigint NOT NULL CHECK(log_index>=0),
 payload jsonb NOT NULL CHECK(jsonb_typeof(payload)='object'),
 PRIMARY KEY(chain_id,block_hash,log_index,account),
 FOREIGN KEY(chain_id,block_hash) REFERENCES tickergarden.user_activity_blocks(chain_id,block_hash) ON DELETE CASCADE
);
CREATE INDEX user_activity_account_history ON tickergarden.user_activity_records(chain_id,account,block_number DESC,transaction_index DESC,log_index DESC);
-- Readers must additionally verify manifest/version, coverage, commitments and
-- fresh chain identity. A canonical filter alone does not establish completeness.
-- +goose Down
DROP TABLE tickergarden.user_activity_records;
DROP TABLE tickergarden.user_activity_blocks;
