CREATE TABLE {{schema}}.protocol_statistics_snapshots (
 environment text NOT NULL,chain_id bigint NOT NULL,deployment_digest text NOT NULL,
 generation bigint NOT NULL,block_hash text NOT NULL,staking_block_hash text,
 generated_at timestamptz NOT NULL,payload jsonb NOT NULL,
 PRIMARY KEY(environment,chain_id,deployment_digest)
);
INSERT INTO {{schema}}.schema_migrations(version) VALUES('0017_protocol_statistics');
