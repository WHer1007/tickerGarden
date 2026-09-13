CREATE TABLE {{schema}}.holder_reward_markets (
 environment text NOT NULL, chain_id bigint NOT NULL, deployment_digest text NOT NULL,
 market_id text NOT NULL, distributor text NOT NULL, block_number bigint NOT NULL, block_hash text NOT NULL,
 generation bigint NOT NULL, payload jsonb NOT NULL,
 PRIMARY KEY(environment,chain_id,deployment_digest,market_id)
);
CREATE TABLE {{schema}}.holder_reward_datasets (
 environment text NOT NULL, chain_id bigint NOT NULL, deployment_digest text NOT NULL,
 market_id text NOT NULL, round bigint NOT NULL CHECK(round>0), data_hash text NOT NULL,
 snapshot_block bigint NOT NULL, snapshot_block_hash text NOT NULL, payload jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(environment,chain_id,deployment_digest,market_id,round,data_hash),
 CHECK(pg_column_size(payload)<=16777216)
);
CREATE TABLE {{schema}}.holder_reward_rounds (
 environment text NOT NULL, chain_id bigint NOT NULL, deployment_digest text NOT NULL,
 market_id text NOT NULL, round bigint NOT NULL, block_number bigint NOT NULL, block_hash text NOT NULL,
 root text NOT NULL, data_hash text NOT NULL, snapshot_block bigint NOT NULL, snapshot_block_hash text NOT NULL,
 quote_budget numeric(78,0) NOT NULL, meme_budget numeric(78,0) NOT NULL,
 PRIMARY KEY(environment,chain_id,deployment_digest,market_id,round)
);
CREATE TABLE {{schema}}.holder_reward_claims (
 environment text NOT NULL, chain_id bigint NOT NULL, deployment_digest text NOT NULL,
 market_id text NOT NULL, round bigint NOT NULL, account text NOT NULL, assets integer NOT NULL CHECK(assets BETWEEN 1 AND 3),
 PRIMARY KEY(environment,chain_id,deployment_digest,market_id,round,account)
);
INSERT INTO {{schema}}.schema_migrations(version) VALUES('0004_holder_rewards');
