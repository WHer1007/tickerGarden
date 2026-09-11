-- +goose Up
-- Immutable token.creator() identity cache for wallet-filtered display queries.
CREATE TABLE tickergarden.creator_market_directory (
 scope_id text NOT NULL REFERENCES tickergarden.demand_event_scopes(scope_id),
 market_id text NOT NULL,
 meme_token text NOT NULL,
 creator text NOT NULL,
 creation_block_number bigint NOT NULL,
 creation_block_hash text NOT NULL,
 PRIMARY KEY(scope_id,market_id)
);
CREATE INDEX creator_market_directory_wallet ON tickergarden.creator_market_directory(scope_id,creator,market_id);
-- +goose Down
DROP TABLE tickergarden.creator_market_directory;
