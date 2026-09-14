-- Canonical finalized time buckets. Raw per-block rollups remain the audit source.
-- Lock both sources across backfill + trigger installation to avoid a write gap.
LOCK TABLE {{schema}}.chain_blocks IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE {{schema}}.trade_flow_rollups IN SHARE ROW EXCLUSIVE MODE;
CREATE TABLE {{schema}}.trade_time_buckets (
 environment text NOT NULL,chain_id bigint NOT NULL,deployment_digest text NOT NULL,
 market_id text NOT NULL,bucket_seconds integer NOT NULL CHECK(bucket_seconds IN (60,3600,86400)),
 occurred_at timestamptz NOT NULL,fee_asset text NOT NULL,
 trade_count bigint NOT NULL,
 internal_count bigint NOT NULL,
 unclassified_count bigint NOT NULL,
 quote_raw numeric NOT NULL,
 internal_quote_raw numeric NOT NULL,
 unknown_fee_count bigint NOT NULL,
 fee_raw numeric NOT NULL,
 tax_raw numeric NOT NULL,
 PRIMARY KEY(environment,chain_id,deployment_digest,bucket_seconds,occurred_at,market_id,fee_asset)
);
CREATE FUNCTION {{schema}}.adjust_trade_bucket(r {{schema}}.trade_flow_rollups,delta integer) RETURNS void LANGUAGE plpgsql AS $$
DECLARE width integer;
BEGIN
 FOREACH width IN ARRAY ARRAY[60,3600,86400] LOOP
 INSERT INTO {{schema}}.trade_time_buckets VALUES(r.environment,r.chain_id,r.deployment_digest,r.market_id,width,to_timestamp(floor(extract(epoch FROM r.occurred_at)/width)*width),r.fee_asset,
delta*r.trade_count,delta*r.internal_count,delta*r.unclassified_count,delta*r.quote_raw,delta*r.internal_quote_raw,delta*r.unknown_fee_count,delta*r.fee_raw,delta*r.tax_raw)
 ON CONFLICT(environment,chain_id,deployment_digest,bucket_seconds,occurred_at,market_id,fee_asset) DO UPDATE SET
 trade_count={{schema}}.trade_time_buckets.trade_count+excluded.trade_count,
 internal_count={{schema}}.trade_time_buckets.internal_count+excluded.internal_count,
 unclassified_count={{schema}}.trade_time_buckets.unclassified_count+excluded.unclassified_count,
 quote_raw={{schema}}.trade_time_buckets.quote_raw+excluded.quote_raw,
 internal_quote_raw={{schema}}.trade_time_buckets.internal_quote_raw+excluded.internal_quote_raw,
 unknown_fee_count={{schema}}.trade_time_buckets.unknown_fee_count+excluded.unknown_fee_count,
 fee_raw={{schema}}.trade_time_buckets.fee_raw+excluded.fee_raw,
 tax_raw={{schema}}.trade_time_buckets.tax_raw+excluded.tax_raw;
 DELETE FROM {{schema}}.trade_time_buckets WHERE environment=r.environment AND chain_id=r.chain_id AND deployment_digest=r.deployment_digest AND market_id=r.market_id AND bucket_seconds=width AND occurred_at=to_timestamp(floor(extract(epoch FROM r.occurred_at)/width)*width) AND fee_asset=r.fee_asset AND trade_count=0;
 END LOOP;
END $$;
CREATE FUNCTION {{schema}}.track_trade_bucket() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE eligible boolean;
BEGIN
 -- Lock even an ineligible block: its concurrent finalization must see this write.
 IF TG_OP<>'INSERT' THEN
 SELECT canonical AND finalized INTO eligible FROM {{schema}}.chain_blocks WHERE environment=OLD.environment AND chain_id=OLD.chain_id AND deployment_digest=OLD.deployment_digest AND hash=OLD.block_hash FOR SHARE;
 IF eligible THEN PERFORM {{schema}}.adjust_trade_bucket(OLD,-1); END IF;
 END IF;
 IF TG_OP<>'DELETE' THEN
 SELECT canonical AND finalized INTO eligible FROM {{schema}}.chain_blocks WHERE environment=NEW.environment AND chain_id=NEW.chain_id AND deployment_digest=NEW.deployment_digest AND hash=NEW.block_hash FOR SHARE;
 IF eligible THEN PERFORM {{schema}}.adjust_trade_bucket(NEW,1); END IF;
 END IF;
 RETURN NULL;
END $$;
CREATE FUNCTION {{schema}}.track_block_trade_buckets() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r {{schema}}.trade_flow_rollups; delta integer;
BEGIN
 IF (OLD.canonical AND OLD.finalized) IS NOT DISTINCT FROM (NEW.canonical AND NEW.finalized) THEN RETURN NULL; END IF;
 delta:=CASE WHEN NEW.canonical AND NEW.finalized THEN 1 ELSE -1 END;
 FOR r IN SELECT * FROM {{schema}}.trade_flow_rollups WHERE environment=NEW.environment AND chain_id=NEW.chain_id AND deployment_digest=NEW.deployment_digest AND block_hash=NEW.hash LOOP
 PERFORM {{schema}}.adjust_trade_bucket(r,delta);
 END LOOP;
 RETURN NULL;
END $$;
INSERT INTO {{schema}}.trade_time_buckets
 SELECT r.environment,r.chain_id,r.deployment_digest,r.market_id,w.width,to_timestamp(floor(extract(epoch FROM r.occurred_at)/w.width)*w.width),r.fee_asset,
sum(r.trade_count),sum(r.internal_count),sum(r.unclassified_count),sum(r.quote_raw),sum(r.internal_quote_raw),sum(r.unknown_fee_count),sum(r.fee_raw),sum(r.tax_raw)
 FROM {{schema}}.trade_flow_rollups r JOIN {{schema}}.chain_blocks b ON b.environment=r.environment AND b.chain_id=r.chain_id AND b.deployment_digest=r.deployment_digest AND b.hash=r.block_hash
 CROSS JOIN (VALUES(60),(3600),(86400)) w(width) WHERE b.canonical AND b.finalized
 GROUP BY r.environment,r.chain_id,r.deployment_digest,r.market_id,w.width,to_timestamp(floor(extract(epoch FROM r.occurred_at)/w.width)*w.width),r.fee_asset;
CREATE TRIGGER trade_bucket_change AFTER INSERT OR UPDATE OR DELETE ON {{schema}}.trade_flow_rollups FOR EACH ROW EXECUTE FUNCTION {{schema}}.track_trade_bucket();
CREATE TRIGGER block_trade_bucket_change AFTER UPDATE OF canonical,finalized ON {{schema}}.chain_blocks FOR EACH ROW EXECUTE FUNCTION {{schema}}.track_block_trade_buckets();
CREATE INDEX trade_rollup_block ON {{schema}}.trade_flow_rollups(environment,chain_id,deployment_digest,block_hash);
CREATE INDEX market_version_created ON {{schema}}.market_record_versions(environment,chain_id,deployment_digest,generation,((payload->'identity'->>'deployedAt')::numeric),identity,valid_from);
INSERT INTO {{schema}}.schema_migrations(version) VALUES('0006_statistics_buckets');
