-- +goose Up
CREATE TABLE tickergarden.treasury_candidates (
 id text PRIMARY KEY CHECK(id ~ '^0x[0-9a-f]{64}$'),
 chain_id bigint NOT NULL REFERENCES tickergarden.chain_journal(chain_id),
 market_id text NOT NULL CHECK(market_id ~ '^0x[0-9a-f]{64}$'),
 epoch_id bigint NOT NULL CHECK(epoch_id > 0 AND epoch_id <= 4294967295),
 source_hash text NOT NULL,
 request_hash text NOT NULL,
 dataset_hash text NOT NULL CHECK(dataset_hash ~ '^0x[0-9a-f]{64}$'),
 payload bytea NOT NULL CHECK(octet_length(payload) <= 134217728),
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(chain_id,source_hash) REFERENCES tickergarden.chain_blocks(chain_id,hash),
 FOREIGN KEY(chain_id,request_hash) REFERENCES tickergarden.chain_blocks(chain_id,hash)
);
CREATE INDEX treasury_candidates_epoch ON tickergarden.treasury_candidates(chain_id,market_id,epoch_id);
-- +goose Down
DROP TABLE tickergarden.treasury_candidates;
