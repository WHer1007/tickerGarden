-- Private resumable Holder computation; only a completed proof header is published.
CREATE TABLE {{schema}}.holder_snapshot_work (
 environment text NOT NULL,chain_id bigint NOT NULL,deployment_digest text NOT NULL,
 market_id text NOT NULL,block_hash text NOT NULL,generation bigint NOT NULL,block_number bigint NOT NULL,
 context jsonb NOT NULL,phase text NOT NULL DEFAULT 'replay',minted boolean NOT NULL DEFAULT false,
 after_block bigint NOT NULL DEFAULT -1,after_tx bigint NOT NULL DEFAULT -1,after_log bigint NOT NULL DEFAULT -1,
 verify_cursor text NOT NULL DEFAULT '',base_hash text,copy_cursor text NOT NULL DEFAULT '',
 tree_level integer NOT NULL DEFAULT 0,tree_cursor bigint NOT NULL DEFAULT 0,proof_cursor bigint NOT NULL DEFAULT 0,
 manifest jsonb,
 PRIMARY KEY(environment,chain_id,deployment_digest,market_id,block_hash,generation)
);
CREATE TABLE {{schema}}.holder_snapshot_balances (
 environment text NOT NULL,chain_id bigint NOT NULL,deployment_digest text NOT NULL,
 market_id text NOT NULL,block_hash text NOT NULL,generation bigint NOT NULL,
 account text NOT NULL,balance numeric(78,0) NOT NULL CHECK(balance>=0),verified boolean NOT NULL DEFAULT false,
 PRIMARY KEY(environment,chain_id,deployment_digest,market_id,block_hash,generation,account)
);
CREATE INDEX holder_balances_unverified ON {{schema}}.holder_snapshot_balances(environment,chain_id,deployment_digest,market_id,block_hash,generation,account) WHERE NOT verified;
CREATE TABLE {{schema}}.holder_snapshot_nodes (
 environment text NOT NULL,chain_id bigint NOT NULL,deployment_digest text NOT NULL,
 market_id text NOT NULL,block_hash text NOT NULL,generation bigint NOT NULL,
 level integer NOT NULL,ordinal bigint NOT NULL,hash text NOT NULL,payload jsonb,
 PRIMARY KEY(environment,chain_id,deployment_digest,market_id,block_hash,generation,level,ordinal)
);
CREATE TABLE {{schema}}.holder_snapshot_evidence (
 environment text NOT NULL,chain_id bigint NOT NULL,deployment_digest text NOT NULL,
 market_id text NOT NULL,round bigint NOT NULL,data_hash text NOT NULL,generation bigint NOT NULL,
 block_hash text NOT NULL,artifact_digest text NOT NULL,verified_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(environment,chain_id,deployment_digest,market_id,round,data_hash,generation)
);
ALTER TABLE {{schema}}.holder_work_candidates ADD COLUMN scan_complete boolean NOT NULL DEFAULT true;
ALTER TABLE {{schema}}.holder_work_candidates ADD COLUMN after_block bigint NOT NULL DEFAULT -1;
ALTER TABLE {{schema}}.holder_work_candidates ADD COLUMN after_tx bigint NOT NULL DEFAULT -1;
ALTER TABLE {{schema}}.holder_work_candidates ADD COLUMN after_log bigint NOT NULL DEFAULT -1;
CREATE INDEX holder_proofs_wallet_round ON {{schema}}.holder_reward_wallet_proofs(environment,chain_id,deployment_digest,market_id,account,round DESC);
INSERT INTO {{schema}}.schema_migrations(version) VALUES('0024_holder_recovery');
