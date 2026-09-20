-- Retain legacy cursor versions, but only one physical ranking store and writer.
ALTER TABLE {{schema}}.explore_cap_snapshots ADD COLUMN legacy boolean NOT NULL DEFAULT false;
ALTER TABLE {{schema}}.explore_cap_ranks ADD COLUMN metrics jsonb;
UPDATE {{schema}}.explore_cap_ranks r SET metrics=c.payload->'metrics' FROM {{schema}}.explore_display_cards c WHERE r.environment=c.environment AND r.chain_id=c.chain_id AND r.deployment_digest=c.deployment_digest AND r.market_id=c.market_id;
INSERT INTO {{schema}}.explore_cap_snapshots(environment,chain_id,deployment_digest,version,scheduled_at,created_at,legacy) SELECT environment,chain_id,deployment_digest,version,scheduled_at,created_at,true FROM {{schema}}.market_cap_snapshots ON CONFLICT DO NOTHING;
INSERT INTO {{schema}}.explore_cap_ranks SELECT environment,chain_id,deployment_digest,version,market_id,rank,metrics FROM {{schema}}.market_cap_ranks ON CONFLICT DO NOTHING;
DROP TABLE {{schema}}.market_cap_ranks;
DROP TABLE {{schema}}.market_cap_snapshots;
-- Names remain read-only compatibility views; no duplicate physical history.
CREATE VIEW {{schema}}.market_cap_snapshots AS SELECT * FROM {{schema}}.explore_cap_snapshots;
CREATE VIEW {{schema}}.market_cap_ranks AS SELECT r.*,c.payload->>'assetUid' asset_uid FROM {{schema}}.explore_cap_ranks r LEFT JOIN {{schema}}.explore_display_cards c USING(environment,chain_id,deployment_digest,market_id);
INSERT INTO {{schema}}.schema_migrations(version) VALUES('0032_unified_rankings');
