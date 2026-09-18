-- Bounded, resumable reward summaries and verified deferred-cleanup observations.
CREATE TABLE {{schema}}.stake_summary_work (
 environment text NOT NULL,chain_id bigint NOT NULL,deployment_digest text NOT NULL,
 generation bigint NOT NULL,block_hash text NOT NULL,base_block bigint NOT NULL,
 cursor text NOT NULL DEFAULT '',progress bigint NOT NULL DEFAULT 0,
 PRIMARY KEY(environment,chain_id,deployment_digest,generation,block_hash)
);
CREATE TABLE {{schema}}.stake_cleanup_observations (
 environment text NOT NULL,chain_id bigint NOT NULL,deployment_digest text NOT NULL,
 generation bigint NOT NULL,asset_uid text NOT NULL,account text NOT NULL,market_id text NOT NULL,
 block_number bigint NOT NULL,block_hash text NOT NULL,principal numeric(78,0) NOT NULL CHECK(principal>=0),
 PRIMARY KEY(environment,chain_id,deployment_digest,generation,asset_uid,account,market_id)
);
CREATE INDEX stake_cleanup_pending ON {{schema}}.stake_cleanup_observations(environment,chain_id,deployment_digest,generation,market_id,account) WHERE principal>0;
CREATE INDEX principal_changed_summary ON {{schema}}.principal_record_versions(environment,chain_id,deployment_digest,generation,valid_from) WHERE scope='positions';
CREATE INDEX principal_closed_summary ON {{schema}}.principal_record_versions(environment,chain_id,deployment_digest,generation,valid_to) WHERE scope='positions' AND valid_to IS NOT NULL;
INSERT INTO {{schema}}.schema_migrations(version) VALUES('0023_stake_recovery');
