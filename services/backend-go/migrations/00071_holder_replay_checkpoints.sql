-- +goose Up
-- Provisional recovery journal: no history/publication approval is stored here.
CREATE TABLE tickergarden.holder_replay_checkpoints (
 scope_digest text NOT NULL CHECK (scope_digest ~ '^[0-9a-f]{64}$'),
 revision bigint NOT NULL CHECK (revision >= 0),
 digest text NOT NULL CHECK (digest ~ '^[0-9a-f]{64}$'),
 payload bytea NOT NULL CHECK (octet_length(payload) <= 5242880),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY (scope_digest, revision)
);
CREATE TABLE tickergarden.holder_replay_heads (
 scope_digest text PRIMARY KEY,
 revision bigint NOT NULL,
 FOREIGN KEY (scope_digest, revision) REFERENCES tickergarden.holder_replay_checkpoints(scope_digest, revision)
);
-- +goose Down
DROP TABLE tickergarden.holder_replay_heads;
DROP TABLE tickergarden.holder_replay_checkpoints;
