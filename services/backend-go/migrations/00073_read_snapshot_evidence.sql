-- Verified financial publication evidence is immutable and committed in the
-- same transaction as its read snapshot.
-- +goose Up
CREATE TABLE tickergarden.read_snapshot_evidence (
 chain_id bigint NOT NULL,
 revision text NOT NULL,
 evidence_digest text NOT NULL CHECK (evidence_digest ~ '^0x[0-9a-f]{64}$'),
 candidate_digest text NOT NULL CHECK (candidate_digest ~ '^0x[0-9a-f]{64}$'),
 manifest_hash text NOT NULL CHECK (manifest_hash ~ '^0x[0-9a-f]{64}$'),
 block_number bigint NOT NULL CHECK (block_number >= 0),
 block_hash text NOT NULL CHECK (block_hash ~ '^0x[0-9a-f]{64}$'),
 payload bytea NOT NULL CHECK (octet_length(payload) BETWEEN 1 AND 1048576),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY (chain_id, revision),
 FOREIGN KEY (chain_id, revision)
   REFERENCES tickergarden.read_snapshots(chain_id, revision)
   ON DELETE RESTRICT
);
REVOKE UPDATE, DELETE ON tickergarden.read_snapshot_evidence FROM PUBLIC;
-- +goose Down
GRANT UPDATE, DELETE ON tickergarden.read_snapshot_evidence TO PUBLIC;
DROP TABLE tickergarden.read_snapshot_evidence;
