-- +goose Up
-- Display-only materialization, never financial settlement evidence.
CREATE TABLE tickergarden.market_statistics (
 chain_id bigint NOT NULL,
 registry text NOT NULL,
 market_id text NOT NULL,
 state jsonb NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(chain_id,registry,market_id)
);
-- +goose Down
DROP TABLE tickergarden.market_statistics;
