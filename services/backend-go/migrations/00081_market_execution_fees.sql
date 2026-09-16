-- +goose Up
ALTER TABLE tickergarden.market_volume_events ADD COLUMN curve_fee numeric(78,0) CHECK(curve_fee>=0);
ALTER TABLE tickergarden.market_volume_cursors ADD COLUMN version integer NOT NULL DEFAULT 1;
CREATE TABLE tickergarden.market_transfer_events (
 chain_id bigint NOT NULL,registry text NOT NULL,market_id text NOT NULL,
 block_number bigint NOT NULL,transaction_hash text NOT NULL,log_index bigint NOT NULL,
 from_address text NOT NULL,to_address text NOT NULL,
 PRIMARY KEY(chain_id,registry,market_id,transaction_hash,log_index)
);
CREATE INDEX market_transfer_wallet ON tickergarden.market_transfer_events(chain_id,to_address,market_id);
-- +goose Down
DROP TABLE tickergarden.market_transfer_events;
ALTER TABLE tickergarden.market_volume_cursors DROP COLUMN version;
ALTER TABLE tickergarden.market_volume_events DROP COLUMN curve_fee;
