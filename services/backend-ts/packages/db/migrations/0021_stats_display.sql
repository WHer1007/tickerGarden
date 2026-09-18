-- Display-only projections share the confirmed event reader; never settlement inputs.
CREATE TABLE {{schema}}.stats_display_snapshots (
 environment text NOT NULL,chain_id bigint NOT NULL,deployment_digest text NOT NULL,
 block_number bigint NOT NULL,block_hash text NOT NULL,generated_at timestamptz NOT NULL,payload jsonb NOT NULL,
 PRIMARY KEY(environment,chain_id,deployment_digest)
);
CREATE TABLE {{schema}}.stats_display_flows (
 environment text NOT NULL,chain_id bigint NOT NULL,deployment_digest text NOT NULL,
 event_key text NOT NULL,block_number bigint NOT NULL,occurred_at bigint NOT NULL,
 kind text NOT NULL,asset text NOT NULL,recipient text NOT NULL DEFAULT '',amount numeric NOT NULL CHECK(amount>=0),
 PRIMARY KEY(environment,chain_id,deployment_digest,event_key,kind,asset,recipient)
);
CREATE INDEX stats_display_flows_time ON {{schema}}.stats_display_flows(environment,chain_id,deployment_digest,occurred_at);
CREATE INDEX stats_display_flows_block ON {{schema}}.stats_display_flows(environment,chain_id,deployment_digest,block_number);
CREATE TABLE {{schema}}.stats_display_buckets (
 environment text NOT NULL,chain_id bigint NOT NULL,deployment_digest text NOT NULL,
 minute bigint NOT NULL,kind text NOT NULL,asset text NOT NULL,recipient text NOT NULL,amount numeric NOT NULL,
 PRIMARY KEY(environment,chain_id,deployment_digest,minute,kind,asset,recipient)
);
CREATE FUNCTION {{schema}}.stats_display_flow_delta() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN
 INSERT INTO {{schema}}.stats_display_buckets SELECT environment,chain_id,deployment_digest,occurred_at/60*60,kind,asset,recipient,-sum(amount) FROM old_rows GROUP BY environment,chain_id,deployment_digest,occurred_at/60*60,kind,asset,recipient
 ON CONFLICT(environment,chain_id,deployment_digest,minute,kind,asset,recipient) DO UPDATE SET amount={{schema}}.stats_display_buckets.amount+excluded.amount;
 ELSE
 INSERT INTO {{schema}}.stats_display_buckets SELECT environment,chain_id,deployment_digest,occurred_at/60*60,kind,asset,recipient,sum(amount) FROM new_rows GROUP BY environment,chain_id,deployment_digest,occurred_at/60*60,kind,asset,recipient
 ON CONFLICT(environment,chain_id,deployment_digest,minute,kind,asset,recipient) DO UPDATE SET amount={{schema}}.stats_display_buckets.amount+excluded.amount;
 END IF;
 RETURN NULL;
END $$;
CREATE TRIGGER stats_flow_insert AFTER INSERT ON {{schema}}.stats_display_flows REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION {{schema}}.stats_display_flow_delta();
CREATE TRIGGER stats_flow_delete AFTER DELETE ON {{schema}}.stats_display_flows REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION {{schema}}.stats_display_flow_delta();
CREATE TABLE {{schema}}.stats_display_positions (
 environment text NOT NULL,chain_id bigint NOT NULL,deployment_digest text NOT NULL,
 asset_uid text NOT NULL,account text NOT NULL,amount numeric NOT NULL CHECK(amount>=0),
 PRIMARY KEY(environment,chain_id,deployment_digest,asset_uid,account)
);
-- Small market contribution rows; the snapshot builder never reads holder arrays.
CREATE TABLE {{schema}}.stats_display_markets (
 environment text NOT NULL,chain_id bigint NOT NULL,deployment_digest text NOT NULL,market_id text NOT NULL,
 payload jsonb NOT NULL,PRIMARY KEY(environment,chain_id,deployment_digest,market_id)
);
ALTER TABLE {{schema}}.stats_display_markets
 ADD COLUMN created_at bigint GENERATED ALWAYS AS (CASE WHEN payload->>'createdAt' ~ '^[0-9]+$' THEN (payload->>'createdAt')::bigint END) STORED,
 ADD COLUMN token text GENERATED ALWAYS AS (payload->>'token') STORED;
CREATE INDEX stats_market_created ON {{schema}}.stats_display_markets(environment,chain_id,deployment_digest,created_at);
CREATE INDEX stats_market_token ON {{schema}}.stats_display_markets(environment,chain_id,deployment_digest,token);
CREATE TABLE {{schema}}.stats_display_counts (
 environment text NOT NULL,chain_id bigint NOT NULL,deployment_digest text NOT NULL,
 bloomed bigint NOT NULL DEFAULT 0,invalid_dates bigint NOT NULL DEFAULT 0,
 PRIMARY KEY(environment,chain_id,deployment_digest)
);
CREATE FUNCTION {{schema}}.stats_display_count_delta() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP!='INSERT' THEN
 INSERT INTO {{schema}}.stats_display_counts SELECT environment,chain_id,deployment_digest,-count(*) FILTER(WHERE payload->>'phase'='1'),-count(*) FILTER(WHERE created_at IS NULL) FROM old_rows GROUP BY environment,chain_id,deployment_digest
 ON CONFLICT(environment,chain_id,deployment_digest) DO UPDATE SET bloomed={{schema}}.stats_display_counts.bloomed+excluded.bloomed,invalid_dates={{schema}}.stats_display_counts.invalid_dates+excluded.invalid_dates;
 END IF;
 IF TG_OP!='DELETE' THEN
 INSERT INTO {{schema}}.stats_display_counts SELECT environment,chain_id,deployment_digest,count(*) FILTER(WHERE payload->>'phase'='1'),count(*) FILTER(WHERE created_at IS NULL) FROM new_rows GROUP BY environment,chain_id,deployment_digest
 ON CONFLICT(environment,chain_id,deployment_digest) DO UPDATE SET bloomed={{schema}}.stats_display_counts.bloomed+excluded.bloomed,invalid_dates={{schema}}.stats_display_counts.invalid_dates+excluded.invalid_dates;
 END IF;
 RETURN NULL;
END $$;
CREATE TRIGGER stats_count_insert AFTER INSERT ON {{schema}}.stats_display_markets REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION {{schema}}.stats_display_count_delta();
CREATE TRIGGER stats_count_update AFTER UPDATE ON {{schema}}.stats_display_markets REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION {{schema}}.stats_display_count_delta();
CREATE TRIGGER stats_count_delete AFTER DELETE ON {{schema}}.stats_display_markets REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION {{schema}}.stats_display_count_delta();
CREATE TABLE {{schema}}.stats_display_stock_totals (
 environment text NOT NULL,chain_id bigint NOT NULL,deployment_digest text NOT NULL,asset_uid text NOT NULL,amount numeric NOT NULL,
 PRIMARY KEY(environment,chain_id,deployment_digest,asset_uid)
);
CREATE TABLE {{schema}}.stats_display_wallet_refs (
 environment text NOT NULL,chain_id bigint NOT NULL,deployment_digest text NOT NULL,account text NOT NULL,refs bigint NOT NULL,
 PRIMARY KEY(environment,chain_id,deployment_digest,account)
);
CREATE FUNCTION {{schema}}.stats_display_position_delta() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP!='INSERT' THEN
 UPDATE {{schema}}.stats_display_stock_totals SET amount=amount-OLD.amount WHERE environment=OLD.environment AND chain_id=OLD.chain_id AND deployment_digest=OLD.deployment_digest AND asset_uid=OLD.asset_uid;
 UPDATE {{schema}}.stats_display_wallet_refs SET refs=refs-CASE WHEN OLD.amount>0 THEN 1 ELSE 0 END WHERE environment=OLD.environment AND chain_id=OLD.chain_id AND deployment_digest=OLD.deployment_digest AND account=OLD.account;
 END IF;
 IF TG_OP!='DELETE' THEN
 INSERT INTO {{schema}}.stats_display_stock_totals VALUES(NEW.environment,NEW.chain_id,NEW.deployment_digest,NEW.asset_uid,NEW.amount)
 ON CONFLICT(environment,chain_id,deployment_digest,asset_uid) DO UPDATE SET amount={{schema}}.stats_display_stock_totals.amount+excluded.amount;
 INSERT INTO {{schema}}.stats_display_wallet_refs VALUES(NEW.environment,NEW.chain_id,NEW.deployment_digest,NEW.account,CASE WHEN NEW.amount>0 THEN 1 ELSE 0 END)
 ON CONFLICT(environment,chain_id,deployment_digest,account) DO UPDATE SET refs={{schema}}.stats_display_wallet_refs.refs+excluded.refs;
 END IF;
 RETURN NULL;
END $$;
CREATE TRIGGER stats_position_delta AFTER INSERT OR UPDATE OR DELETE ON {{schema}}.stats_display_positions FOR EACH ROW EXECUTE FUNCTION {{schema}}.stats_display_position_delta();
CREATE INDEX stats_wallet_positive ON {{schema}}.stats_display_wallet_refs(environment,chain_id,deployment_digest) WHERE refs>0;
CREATE FUNCTION {{schema}}.stats_display_market_delta() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN
 DELETE FROM {{schema}}.stats_display_markets m USING old_rows r WHERE m.environment=r.environment AND m.chain_id=r.chain_id AND m.deployment_digest=r.deployment_digest AND m.market_id=r.market_id;
 ELSE
 INSERT INTO {{schema}}.stats_display_markets(environment,chain_id,deployment_digest,market_id,payload)
 SELECT environment,chain_id,deployment_digest,market_id,jsonb_build_object('createdAt',payload->'market'->'identity'->'deployedAt','phase',payload->'market'->'launchPhase','token',payload->'market'->'memeToken','quote',payload->'market'->'quoteAsset','price',payload->'market'->'display'->'priceQuote') FROM new_rows
 ON CONFLICT(environment,chain_id,deployment_digest,market_id) DO UPDATE SET payload=excluded.payload WHERE {{schema}}.stats_display_markets.payload IS DISTINCT FROM excluded.payload;
 END IF;
 RETURN NULL;
END $$;
CREATE TRIGGER stats_market_insert AFTER INSERT ON {{schema}}.confirmed_display_markets REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION {{schema}}.stats_display_market_delta();
CREATE TRIGGER stats_market_update AFTER UPDATE ON {{schema}}.confirmed_display_markets REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION {{schema}}.stats_display_market_delta();
CREATE TRIGGER stats_market_delete AFTER DELETE ON {{schema}}.confirmed_display_markets REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION {{schema}}.stats_display_market_delta();
ALTER TABLE {{schema}}.confirmed_display_journal ADD COLUMN stats_undo jsonb NOT NULL DEFAULT '{}';
INSERT INTO {{schema}}.schema_migrations(version) VALUES('0021_stats_display');
