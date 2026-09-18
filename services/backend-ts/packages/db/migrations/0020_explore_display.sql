-- Explore shares the receipt-verified display model; settlement remains separate.
-- A small stored card avoids detoasting holders/trades/charts for directory reads.
ALTER TABLE "{{schema}}".confirmed_display_markets ADD COLUMN explore_card jsonb GENERATED ALWAYS AS (payload->'market') STORED;
ALTER TABLE "{{schema}}".recent_markets ADD COLUMN display_checked_at timestamptz;
CREATE VIEW "{{schema}}".explore_display_cards AS
 SELECT m.environment,m.chain_id,m.deployment_digest,m.market_id,m.explore_card payload
 FROM "{{schema}}".confirmed_display_markets m
 JOIN "{{schema}}".confirmed_display_cursor c USING(environment,chain_id,deployment_digest)
 WHERE m.block_number<=c.block_number
 UNION ALL
 SELECT r.environment,r.chain_id::integer,r.deployment_digest::text,r.market_id::text,r.payload
 FROM "{{schema}}".recent_markets r
 WHERE r.canonical AND r.expires_at>now() AND NOT EXISTS (
  SELECT 1 FROM "{{schema}}".confirmed_display_markets m
  JOIN "{{schema}}".confirmed_display_cursor c USING(environment,chain_id,deployment_digest)
  WHERE m.environment=r.environment AND m.chain_id=r.chain_id AND m.deployment_digest=r.deployment_digest
   AND m.market_id=r.market_id AND m.block_number<=c.block_number
 );
CREATE TABLE "{{schema}}".explore_cap_snapshots (
 environment text NOT NULL,chain_id bigint NOT NULL,deployment_digest text NOT NULL,version text NOT NULL,
 scheduled_at timestamptz NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(environment,chain_id,deployment_digest,version)
);
CREATE INDEX explore_cap_latest ON "{{schema}}".explore_cap_snapshots(environment,chain_id,deployment_digest,scheduled_at DESC,created_at DESC);
CREATE TABLE "{{schema}}".explore_cap_ranks (
 environment text NOT NULL,chain_id bigint NOT NULL,deployment_digest text NOT NULL,version text NOT NULL,
 market_id text NOT NULL,rank bigint NOT NULL,
 PRIMARY KEY(environment,chain_id,deployment_digest,version,market_id),
 FOREIGN KEY(environment,chain_id,deployment_digest,version) REFERENCES "{{schema}}".explore_cap_snapshots ON DELETE CASCADE
);
CREATE INDEX display_market_phase_created ON "{{schema}}".confirmed_display_markets(environment,chain_id,deployment_digest,
 ((explore_card->>'launchPhase')),(coalesce((explore_card->'identity'->>'deployedAt')::numeric,0)) DESC,market_id);
CREATE INDEX display_market_recent_buy ON "{{schema}}".confirmed_display_markets(environment,chain_id,deployment_digest,
 ((explore_card->>'launchPhase')),
 (coalesce((explore_card->'lastBuy'->>'blockNumber')::numeric*18446744073709551616+(explore_card->'lastBuy'->>'transactionIndex')::numeric*4294967296+(explore_card->'lastBuy'->>'logIndex')::numeric,0)) DESC,market_id);
CREATE INDEX display_rolling_refresh ON "{{schema}}".confirmed_display_markets(environment,chain_id,deployment_digest,
 (coalesce((payload->'detailViews'->'1H'->'sources'->'statistics'->>'asOf')::bigint,0)),market_id);
INSERT INTO "{{schema}}".schema_migrations(version) VALUES('0020_explore_display');
