-- +goose Up
-- Public display caches only; never an authority for settlement or signatures.
CREATE TABLE tickergarden.display_block_times (
 chain_id bigint NOT NULL, block_hash text NOT NULL, block_number bigint NOT NULL,
 block_time bigint NOT NULL CHECK(block_time>=0), PRIMARY KEY(chain_id,block_hash)
);
CREATE TABLE tickergarden.display_snapshots (
 scope_id text NOT NULL REFERENCES tickergarden.demand_event_scopes(scope_id),
 name text NOT NULL, snapshot jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(scope_id,name)
);
CREATE TABLE tickergarden.market_volume_events (
 chain_id bigint NOT NULL, registry text NOT NULL, market_id text NOT NULL,
 block_number bigint NOT NULL, block_hash text NOT NULL, transaction_hash text NOT NULL,
 log_index bigint NOT NULL, block_time bigint NOT NULL, amount numeric(78,0) NOT NULL CHECK(amount>=0),
 PRIMARY KEY(chain_id,registry,market_id,transaction_hash,log_index)
);
CREATE TABLE tickergarden.market_volume_cursors (
 chain_id bigint NOT NULL, registry text NOT NULL, market_id text NOT NULL,
 through_block bigint NOT NULL, block_hash text NOT NULL, PRIMARY KEY(chain_id,registry,market_id)
);
CREATE INDEX market_volume_window ON tickergarden.market_volume_events(chain_id,registry,market_id,block_time);
CREATE INDEX demand_event_market ON tickergarden.demand_event_records(scope_id,(payload->'event'->'args'->>'marketId'),block_number);
CREATE INDEX demand_event_emitter ON tickergarden.demand_event_records(scope_id,(payload->'event'->>'emitter'),block_number);
-- +goose Down
DROP INDEX tickergarden.demand_event_emitter;
DROP INDEX tickergarden.demand_event_market;
DROP TABLE tickergarden.market_volume_events;
DROP TABLE tickergarden.market_volume_cursors;
DROP TABLE tickergarden.display_snapshots;
DROP TABLE tickergarden.display_block_times;
