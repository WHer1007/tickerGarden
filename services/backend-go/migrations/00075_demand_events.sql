-- +goose Up
-- Display/query history only. No receipt-root or financial evidence promotion.
CREATE TABLE tickergarden.demand_event_scopes (
 scope_id text PRIMARY KEY,
 chain_id bigint NOT NULL,
 config jsonb NOT NULL,
 start_block bigint NOT NULL CHECK(start_block>0),
 read_through bigint NOT NULL,
 processed_through bigint NOT NULL,
 head_number bigint,
 head_hash text,
 head_timestamp bigint,
 observed_at timestamptz,
 retry_at timestamptz NOT NULL DEFAULT '-infinity',
 CHECK(processed_through<=read_through AND read_through>=start_block-1)
);
CREATE TABLE tickergarden.demand_event_ranges (
 scope_id text NOT NULL REFERENCES tickergarden.demand_event_scopes(scope_id),
 from_block bigint NOT NULL,
 to_block bigint NOT NULL CHECK(to_block>=from_block),
 event_count integer NOT NULL CHECK(event_count>=0),
 PRIMARY KEY(scope_id,from_block)
);
CREATE TABLE tickergarden.demand_event_jobs (
 scope_id text NOT NULL,
 from_block bigint NOT NULL,
 logs jsonb NOT NULL CHECK(jsonb_typeof(logs)='array'),
 state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','done','failed')),
 attempts integer NOT NULL DEFAULT 0,
 retry_at timestamptz NOT NULL DEFAULT '-infinity',
 last_error text,
 PRIMARY KEY(scope_id,from_block),
 FOREIGN KEY(scope_id,from_block) REFERENCES tickergarden.demand_event_ranges(scope_id,from_block)
);
CREATE INDEX demand_event_jobs_pending ON tickergarden.demand_event_jobs(scope_id,from_block) WHERE state<>'done';
CREATE TABLE tickergarden.demand_event_records (
 scope_id text NOT NULL REFERENCES tickergarden.demand_event_scopes(scope_id),
 block_number bigint NOT NULL,
 transaction_index bigint NOT NULL,
 log_index bigint NOT NULL,
 block_hash text NOT NULL,
 payload jsonb NOT NULL,
 PRIMARY KEY(scope_id,block_number,log_index)
);
-- +goose Down
DROP TABLE tickergarden.demand_event_records;
DROP TABLE tickergarden.demand_event_jobs;
DROP TABLE tickergarden.demand_event_ranges;
DROP TABLE tickergarden.demand_event_scopes;
