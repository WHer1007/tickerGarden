-- Resumable RPC observations are not publications. Only verified complete
-- candidates pass through the existing atomic publisher/finality fence.
CREATE TABLE {{schema}}.projection_observations (
 environment text NOT NULL, chain_id bigint NOT NULL, deployment_digest text NOT NULL,
 scope text NOT NULL, block_number bigint NOT NULL, block_hash text NOT NULL,
 generation bigint NOT NULL, algorithm_version text NOT NULL, identity text NOT NULL,
 payload jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(environment,chain_id,deployment_digest,scope,block_hash,generation,algorithm_version,identity)
);
CREATE INDEX projection_market_name ON {{schema}}.projection_records
 (environment,chain_id,deployment_digest,scope,revision,lower(payload->'identity'->>'name'),identity) WHERE scope='markets';
CREATE INDEX projection_market_phase ON {{schema}}.projection_records
 (environment,chain_id,deployment_digest,scope,revision,((payload->>'launchPhase')::int),sort_key,identity) WHERE scope='markets';
CREATE INDEX projection_market_token ON {{schema}}.projection_records
 (environment,chain_id,deployment_digest,scope,revision,(payload->>'memeToken')) WHERE scope='markets';
CREATE INDEX chain_logs_canonical_address_block ON {{schema}}.chain_logs
 (environment,chain_id,deployment_digest,address,block_hash,transaction_index,log_index) WHERE canonical;
INSERT INTO {{schema}}.schema_migrations(version) VALUES('0005_capacity');

-- Per block/market/fee-asset aggregates retain fork provenance and exact time
-- boundaries. The trigger runs in the same transaction as canonical trade writes.
CREATE TABLE {{schema}}.trade_flow_rollups (
 environment text NOT NULL,chain_id bigint NOT NULL,deployment_digest text NOT NULL,
 market_id text NOT NULL,block_hash text NOT NULL,occurred_at timestamptz NOT NULL,fee_asset text NOT NULL,
 trade_count bigint NOT NULL,internal_count bigint NOT NULL,unclassified_count bigint NOT NULL,
 quote_raw numeric NOT NULL,internal_quote_raw numeric NOT NULL,unknown_fee_count bigint NOT NULL,
 fee_raw numeric NOT NULL,tax_raw numeric NOT NULL,
 PRIMARY KEY(environment,chain_id,deployment_digest,market_id,block_hash,occurred_at,fee_asset)
);
CREATE INDEX trade_flow_rollups_window ON {{schema}}.trade_flow_rollups(environment,chain_id,deployment_digest,occurred_at,block_hash);
CREATE FUNCTION {{schema}}.accumulate_trade_flow() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r record; delta integer;
BEGIN
 FOR delta IN SELECT unnest(CASE TG_OP WHEN 'UPDATE' THEN ARRAY[-1,1] WHEN 'DELETE' THEN ARRAY[-1] ELSE ARRAY[1] END) LOOP
 IF delta=-1 THEN r:=OLD; ELSE r:=NEW; END IF;
 INSERT INTO {{schema}}.trade_flow_rollups VALUES(r.environment,r.chain_id,r.deployment_digest,r.market_id,r.block_hash,r.occurred_at,coalesce(r.payload->>'feeAsset',''),
 delta,delta*(r.classification<>'unclassified')::int,delta*(r.classification='unclassified')::int,
 delta*r.quote_raw,delta*CASE WHEN r.classification<>'unclassified' THEN r.quote_raw ELSE 0 END,
 delta*(coalesce(r.payload->>'feeStatus','')='not_provided')::int,
 delta*coalesce((r.payload->>'feeRaw')::numeric,0),delta*coalesce((r.payload->>'taxRaw')::numeric,0))
 ON CONFLICT(environment,chain_id,deployment_digest,market_id,block_hash,occurred_at,fee_asset) DO UPDATE SET
 trade_count={{schema}}.trade_flow_rollups.trade_count+excluded.trade_count,
 internal_count={{schema}}.trade_flow_rollups.internal_count+excluded.internal_count,
 unclassified_count={{schema}}.trade_flow_rollups.unclassified_count+excluded.unclassified_count,
 quote_raw={{schema}}.trade_flow_rollups.quote_raw+excluded.quote_raw,
 internal_quote_raw={{schema}}.trade_flow_rollups.internal_quote_raw+excluded.internal_quote_raw,
 unknown_fee_count={{schema}}.trade_flow_rollups.unknown_fee_count+excluded.unknown_fee_count,
 fee_raw={{schema}}.trade_flow_rollups.fee_raw+excluded.fee_raw,tax_raw={{schema}}.trade_flow_rollups.tax_raw+excluded.tax_raw;
 IF delta=-1 THEN DELETE FROM {{schema}}.trade_flow_rollups WHERE environment=r.environment AND chain_id=r.chain_id AND deployment_digest=r.deployment_digest AND market_id=r.market_id AND block_hash=r.block_hash AND occurred_at=r.occurred_at AND fee_asset=coalesce(r.payload->>'feeAsset','') AND trade_count=0; END IF;
 END LOOP;
 RETURN NULL;
END $$;
-- Freeze trade writes across backfill and trigger installation; readers remain allowed.
LOCK TABLE {{schema}}.market_trades IN SHARE ROW EXCLUSIVE MODE;
INSERT INTO {{schema}}.trade_flow_rollups
 SELECT environment,chain_id,deployment_digest,market_id,block_hash,occurred_at,coalesce(payload->>'feeAsset',''),
 count(*),count(*) FILTER(WHERE classification<>'unclassified'),count(*) FILTER(WHERE classification='unclassified'),sum(quote_raw),coalesce(sum(quote_raw) FILTER(WHERE classification<>'unclassified'),0),count(*) FILTER(WHERE payload->>'feeStatus'='not_provided'),coalesce(sum((payload->>'feeRaw')::numeric),0),coalesce(sum((payload->>'taxRaw')::numeric),0)
 FROM {{schema}}.market_trades GROUP BY environment,chain_id,deployment_digest,market_id,block_hash,occurred_at,coalesce(payload->>'feeAsset','');
CREATE TRIGGER trade_flow_insert AFTER INSERT ON {{schema}}.market_trades FOR EACH ROW EXECUTE FUNCTION {{schema}}.accumulate_trade_flow();
CREATE TRIGGER trade_flow_delete AFTER DELETE ON {{schema}}.market_trades FOR EACH ROW EXECUTE FUNCTION {{schema}}.accumulate_trade_flow();
CREATE TRIGGER trade_flow_update AFTER UPDATE ON {{schema}}.market_trades FOR EACH ROW EXECUTE FUNCTION {{schema}}.accumulate_trade_flow();

SELECT pg_advisory_xact_lock(hashtextextended('tickergarden:extension:pg_trgm',0));
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;
CREATE FUNCTION {{schema}}.market_search_text(value jsonb) RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
 SELECT lower(coalesce(value->>'marketId','')||' '||coalesce(value->'identity'->>'name','')||' '||coalesce(value->'identity'->>'symbol','')||' '||coalesce(value->>'memeToken',''))
$$;
CREATE INDEX projection_market_search ON {{schema}}.projection_records USING gin ({{schema}}.market_search_text(payload) public.gin_trgm_ops) WHERE scope='markets';
CREATE INDEX projection_market_created ON {{schema}}.projection_records (environment,chain_id,deployment_digest,scope,revision,((payload->'identity'->>'deployedAt')::numeric),identity) WHERE scope='markets';

-- Immutable market state versions, with only a monotonically closed validity
-- interval mutable. Publications select a complete state at their own anchor.
CREATE TABLE {{schema}}.market_record_versions (
 environment text NOT NULL,chain_id bigint NOT NULL,deployment_digest text NOT NULL,generation bigint NOT NULL,
 identity text NOT NULL,valid_from bigint NOT NULL,valid_to bigint,sort_key text NOT NULL,payload_digest text NOT NULL,payload jsonb NOT NULL,
 PRIMARY KEY(environment,chain_id,deployment_digest,generation,identity,valid_from),CHECK(valid_to IS NULL OR valid_to>valid_from)
);
CREATE UNIQUE INDEX market_version_current ON {{schema}}.market_record_versions(environment,chain_id,deployment_digest,generation,identity) WHERE valid_to IS NULL;
CREATE FUNCTION {{schema}}.protect_market_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'market state versions are immutable'; END IF;
 IF (to_jsonb(NEW)-'valid_to')<>(to_jsonb(OLD)-'valid_to') OR OLD.valid_to IS NOT NULL OR NEW.valid_to IS NULL OR NEW.valid_to<=OLD.valid_from THEN RAISE EXCEPTION 'only closing a market validity interval is allowed'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER market_version_immutable BEFORE UPDATE OR DELETE ON {{schema}}.market_record_versions FOR EACH ROW EXECUTE FUNCTION {{schema}}.protect_market_version();
CREATE VIEW {{schema}}.projection_read_records AS
 SELECT * FROM {{schema}}.projection_records
 UNION ALL
 SELECT v.environment,v.chain_id,v.deployment_digest,p.scope,p.revision,v.identity,v.sort_key,v.payload_digest,v.payload
 FROM {{schema}}.market_record_versions v JOIN {{schema}}.publications p
 ON p.environment=v.environment AND p.chain_id=v.chain_id AND p.deployment_digest=v.deployment_digest AND p.generation=v.generation
 AND p.scope='markets' AND p.payload->>'storage'='market-versions-v1'
 AND v.valid_from<=p.block_number AND (v.valid_to IS NULL OR v.valid_to>p.block_number);
CREATE INDEX market_version_name ON {{schema}}.market_record_versions(environment,chain_id,deployment_digest,generation,lower(payload->'identity'->>'name'),identity,valid_from);
CREATE INDEX market_version_phase ON {{schema}}.market_record_versions(environment,chain_id,deployment_digest,generation,((payload->>'launchPhase')::int),sort_key,identity,valid_from);
CREATE INDEX market_version_search ON {{schema}}.market_record_versions USING gin ({{schema}}.market_search_text(payload) public.gin_trgm_ops);
