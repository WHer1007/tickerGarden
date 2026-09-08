-- Canonical replay evidence is append-only and bound to a persisted checkpoint.
-- The bound reflects the existing 32 MiB transaction block, 64 MiB receipt and
-- 256 x 1 MiB trace limits plus canonical JSON overhead. This table is audit
-- evidence only; it is not a publication or payout source.
-- +goose Up
CREATE TABLE tickergarden.holder_replay_evidence (
 scope_digest text NOT NULL CHECK (scope_digest ~ '^[0-9a-f]{64}$'),
 revision bigint NOT NULL CHECK (revision >= 0),
 evidence_digest text NOT NULL CHECK (evidence_digest ~ '^sha256:[0-9a-f]{64}$'),
 payload bytea NOT NULL CHECK (octet_length(payload) BETWEEN 1 AND 402653184),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY (scope_digest, revision),
 FOREIGN KEY (scope_digest, revision)
   REFERENCES tickergarden.holder_replay_checkpoints(scope_digest, revision)
   ON DELETE RESTRICT
);
REVOKE UPDATE, DELETE ON tickergarden.holder_replay_evidence FROM PUBLIC;
-- +goose Down
GRANT UPDATE, DELETE ON tickergarden.holder_replay_evidence TO PUBLIC;
DROP TABLE tickergarden.holder_replay_evidence;
