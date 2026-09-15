CREATE TABLE {{schema}}.history_contributions (
 environment text NOT NULL,chain_id bigint NOT NULL,deployment_digest text NOT NULL,
 scope text NOT NULL,identity text NOT NULL,block_number bigint NOT NULL,block_hash text NOT NULL,payload jsonb NOT NULL,
 PRIMARY KEY(environment,chain_id,deployment_digest,scope,identity,block_hash)
);
CREATE INDEX history_contributions_range ON {{schema}}.history_contributions(environment,chain_id,deployment_digest,block_number);
CREATE INDEX reward_history_rewind ON {{schema}}.reward_history(environment,chain_id,deployment_digest,through_block);
CREATE FUNCTION {{schema}}.rewind_history_projection() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.canonical AND NOT NEW.canonical THEN
  UPDATE {{schema}}.projection_checkpoints SET next_block=LEAST(next_block,OLD.number),last_revision=NULL
   WHERE environment=OLD.environment AND chain_id=OLD.chain_id AND deployment_digest=OLD.deployment_digest AND scope='history';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER rewind_history_projection AFTER UPDATE OF canonical ON {{schema}}.chain_blocks FOR EACH ROW EXECUTE FUNCTION {{schema}}.rewind_history_projection();
ALTER TABLE {{schema}}.holder_reward_datasets ADD COLUMN verified_header jsonb;
CREATE TABLE {{schema}}.holder_reward_wallet_proofs (
 environment text NOT NULL,chain_id bigint NOT NULL,deployment_digest text NOT NULL,market_id text NOT NULL,
 round bigint NOT NULL,data_hash text NOT NULL,account text NOT NULL,payload jsonb NOT NULL,
 PRIMARY KEY(environment,chain_id,deployment_digest,market_id,round,data_hash,account),
 FOREIGN KEY(environment,chain_id,deployment_digest,market_id,round,data_hash)
 REFERENCES {{schema}}.holder_reward_datasets(environment,chain_id,deployment_digest,market_id,round,data_hash) ON DELETE CASCADE
);
CREATE FUNCTION {{schema}}.invalidate_holder_proof_index() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.payload IS DISTINCT FROM OLD.payload THEN
  NEW.verified_header=NULL;
  DELETE FROM {{schema}}.holder_reward_wallet_proofs WHERE environment=OLD.environment AND chain_id=OLD.chain_id AND deployment_digest=OLD.deployment_digest AND market_id=OLD.market_id AND round=OLD.round AND data_hash=OLD.data_hash;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER invalidate_holder_proof_index BEFORE UPDATE OF payload ON {{schema}}.holder_reward_datasets FOR EACH ROW EXECUTE FUNCTION {{schema}}.invalidate_holder_proof_index();
INSERT INTO {{schema}}.schema_migrations(version) VALUES('0016_reward_read_paths');
