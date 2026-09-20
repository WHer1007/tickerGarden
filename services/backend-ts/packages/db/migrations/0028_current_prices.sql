-- Pause price publishers and export history to NDJSON before applying in production.
-- Readers retain the same table/columns; restart publishers with the new upsert.
LOCK TABLE "{{schema}}".price_references IN ACCESS EXCLUSIVE MODE;
CREATE TEMP TABLE tg_current_prices ON COMMIT DROP AS
SELECT DISTINCT ON(environment,chain_id,deployment_digest,asset,source)
 environment,chain_id,deployment_digest,asset,source,status,value,as_of,expires_at,payload,
 max(COALESCE((payload->>'retrievedAt')::timestamptz,as_of)) OVER (
   PARTITION BY environment,chain_id,deployment_digest,asset,source
 ) AS observed_at
FROM "{{schema}}".price_references
ORDER BY environment,chain_id,deployment_digest,asset,source,
 (status='available' AND expires_at>statement_timestamp()) DESC,as_of DESC;

-- Transactional replacement also releases the old heap/index space on commit.
TRUNCATE "{{schema}}".price_references;
ALTER TABLE "{{schema}}".price_references DROP CONSTRAINT price_references_pkey;
ALTER TABLE "{{schema}}".price_references ADD COLUMN observed_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE "{{schema}}".price_references ADD PRIMARY KEY(environment,chain_id,deployment_digest,asset,source);
INSERT INTO "{{schema}}".price_references(environment,chain_id,deployment_digest,asset,source,status,value,as_of,expires_at,payload,observed_at)
SELECT environment,chain_id,deployment_digest,asset,source,status,value,as_of,expires_at,payload,observed_at FROM tg_current_prices;
ANALYZE "{{schema}}".price_references;
INSERT INTO "{{schema}}".schema_migrations(version) VALUES('0028_current_prices');
