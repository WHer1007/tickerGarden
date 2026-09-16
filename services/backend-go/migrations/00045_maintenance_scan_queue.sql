-- +goose Up
CREATE TABLE tickergarden.maintenance_scan_queue (
 chain_id bigint NOT NULL,
 genesis_hash text NOT NULL CHECK(genesis_hash ~ '^0x[0-9a-f]{64}$'),
 sender text NOT NULL CHECK(sender ~ '^0x[0-9a-f]{40}$'),
 market_id text NOT NULL CHECK(market_id ~ '^0x[0-9a-f]{64}$'),
 operation text NOT NULL CHECK(operation IN ('sweep','checkpoint','flush-forfeiture','treasury-activate')),
 generation bigint NOT NULL DEFAULT 0 CHECK(generation>=0),
 failures integer NOT NULL DEFAULT 0 CHECK(failures BETWEEN 0 AND 16),
 due_at timestamptz NOT NULL DEFAULT now(),
 claim_until timestamptz NOT NULL DEFAULT '-infinity',
 checked_at timestamptz,
 status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','not_needed','prepared','awaiting_existing','unavailable')),
 PRIMARY KEY(chain_id,genesis_hash,sender,market_id,operation)
);
CREATE INDEX maintenance_scan_due ON tickergarden.maintenance_scan_queue(chain_id,genesis_hash,sender,due_at);
-- +goose Down
DROP TABLE tickergarden.maintenance_scan_queue;
