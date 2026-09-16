-- +goose Up
-- Read-only scoped evidence. This table is never a financial publication source.
CREATE TABLE tickergarden.observation_work (
 request_key text PRIMARY KEY CHECK (request_key ~ '^0x[0-9a-f]{64}$'),
 request bytea NOT NULL CHECK (octet_length(request) <= 8388608),
 state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','running','complete')),
 generation bigint NOT NULL DEFAULT 0,
 attempts bigint NOT NULL DEFAULT 0,
 lease_until timestamptz,
 retry_after timestamptz NOT NULL DEFAULT now(),
 result bytea CHECK (octet_length(result) <= 16777216),
 result_digest text,
 updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK ((state = 'complete') = (result IS NOT NULL AND result_digest IS NOT NULL))
);
CREATE INDEX observation_work_retention ON tickergarden.observation_work(updated_at);

-- +goose Down
DROP TABLE tickergarden.observation_work;
