CREATE TABLE {{schema}}.market_creation_directory (
 environment text NOT NULL,chain_id bigint NOT NULL,deployment_digest text NOT NULL,
 block_hash text NOT NULL,transaction_hash text NOT NULL,log_index bigint NOT NULL,
 market_id text NOT NULL,payload jsonb NOT NULL,
 PRIMARY KEY(environment,chain_id,deployment_digest,block_hash,transaction_hash,log_index),
 FOREIGN KEY(environment,chain_id,deployment_digest,block_hash) REFERENCES {{schema}}.chain_blocks(environment,chain_id,deployment_digest,hash)
);
CREATE INDEX market_directory_id ON {{schema}}.market_creation_directory(environment,chain_id,deployment_digest,market_id);
CREATE TRIGGER market_directory_immutable BEFORE UPDATE OR DELETE ON {{schema}}.market_creation_directory FOR EACH ROW EXECUTE FUNCTION {{schema}}.reject_projection_record_mutation();
CREATE TABLE {{schema}}.market_work_candidates (
 environment text NOT NULL,chain_id bigint NOT NULL,deployment_digest text NOT NULL,
 block_hash text NOT NULL,generation bigint NOT NULL,algorithm_version text NOT NULL,
 base_revision text,expected_population integer NOT NULL,work_count integer NOT NULL,
 PRIMARY KEY(environment,chain_id,deployment_digest,block_hash,generation,algorithm_version)
);
CREATE TABLE {{schema}}.market_observation_work (
 environment text NOT NULL,chain_id bigint NOT NULL,deployment_digest text NOT NULL,
 block_hash text NOT NULL,generation bigint NOT NULL,algorithm_version text NOT NULL,
 market_id text NOT NULL,creation jsonb NOT NULL,
 PRIMARY KEY(environment,chain_id,deployment_digest,block_hash,generation,algorithm_version,market_id)
);
INSERT INTO {{schema}}.schema_migrations(version) VALUES('0007_market_work');

CREATE TABLE {{schema}}.market_time_refresh (
 environment text NOT NULL,chain_id bigint NOT NULL,deployment_digest text NOT NULL,generation bigint NOT NULL,
 market_id text NOT NULL,observed_block_hash text NOT NULL,next_at bigint,
 PRIMARY KEY(environment,chain_id,deployment_digest,generation,market_id)
);
