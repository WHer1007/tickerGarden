-- +goose Up
CREATE TABLE tickergarden.principal_checkpoints (
 chain_id bigint NOT NULL,
 block_hash text NOT NULL,
 parent_hash text,
 payload bytea NOT NULL CHECK(octet_length(payload)<=67117056),
 digest text NOT NULL CHECK(digest ~ '^[0-9a-f]{64}$' AND encode(sha256(payload),'hex')=digest),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(chain_id,block_hash),
 FOREIGN KEY(chain_id,block_hash) REFERENCES tickergarden.chain_blocks(chain_id,hash),
 FOREIGN KEY(chain_id,parent_hash) REFERENCES tickergarden.principal_checkpoints(chain_id,block_hash)
);
CREATE TRIGGER principal_checkpoint_immutable BEFORE UPDATE OR DELETE ON tickergarden.principal_checkpoints FOR EACH ROW EXECUTE FUNCTION tickergarden.reject_treasury_audit_mutation();
-- +goose Down
DROP TABLE tickergarden.principal_checkpoints;
