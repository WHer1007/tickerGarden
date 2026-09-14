CREATE TABLE {{schema}}.holder_work_candidates (
 environment text NOT NULL,chain_id bigint NOT NULL,deployment_digest text NOT NULL,block_hash text NOT NULL,generation bigint NOT NULL,
 from_block bigint NOT NULL,event_count integer NOT NULL,market_count integer NOT NULL,
 PRIMARY KEY(environment,chain_id,deployment_digest,block_hash,generation)
);
CREATE TABLE {{schema}}.holder_work_events (
 environment text NOT NULL,chain_id bigint NOT NULL,deployment_digest text NOT NULL,block_hash text NOT NULL,generation bigint NOT NULL,
 ordinal integer NOT NULL,payload jsonb NOT NULL,
 PRIMARY KEY(environment,chain_id,deployment_digest,block_hash,generation,ordinal)
);
CREATE TABLE {{schema}}.holder_market_work (
 environment text NOT NULL,chain_id bigint NOT NULL,deployment_digest text NOT NULL,block_hash text NOT NULL,generation bigint NOT NULL,
 market_id text NOT NULL,
 PRIMARY KEY(environment,chain_id,deployment_digest,block_hash,generation,market_id)
);
INSERT INTO {{schema}}.schema_migrations(version) VALUES('0009_holder_work');
