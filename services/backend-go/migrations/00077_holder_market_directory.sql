-- +goose Up
CREATE TABLE tickergarden.holder_market_directory (
 scope_id text NOT NULL REFERENCES tickergarden.demand_event_scopes(scope_id),
 market_id text NOT NULL, meme_token text NOT NULL,
 name text NOT NULL, symbol text NOT NULL,
 registration_block_hash text NOT NULL,
 PRIMARY KEY(scope_id,market_id)
);
CREATE INDEX holder_market_directory_search ON tickergarden.holder_market_directory(scope_id,lower(symbol),market_id);
-- +goose Down
DROP TABLE tickergarden.holder_market_directory;
