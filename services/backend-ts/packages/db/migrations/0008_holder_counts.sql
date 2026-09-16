LOCK TABLE {{schema}}.holder_balances,{{schema}}.holder_snapshots,{{schema}}.projection_records,{{schema}}.market_record_versions IN SHARE ROW EXCLUSIVE MODE;
CREATE TABLE {{schema}}.holder_market_assets (
 environment text NOT NULL,chain_id bigint NOT NULL,deployment_digest text NOT NULL,market_id text NOT NULL,asset_uid text NOT NULL,
 PRIMARY KEY(environment,chain_id,deployment_digest,market_id)
);
CREATE TABLE {{schema}}.holder_account_refs (
 environment text NOT NULL,chain_id bigint NOT NULL,deployment_digest text NOT NULL,asset_uid text NOT NULL,account text NOT NULL,refs bigint NOT NULL,
 PRIMARY KEY(environment,chain_id,deployment_digest,asset_uid,account)
);
CREATE TABLE {{schema}}.holder_exclusion_refs (
 environment text NOT NULL,chain_id bigint NOT NULL,deployment_digest text NOT NULL,account text NOT NULL,refs bigint NOT NULL,
 PRIMARY KEY(environment,chain_id,deployment_digest,account)
);
CREATE TABLE {{schema}}.holder_market_counts (
 environment text NOT NULL,chain_id bigint NOT NULL,deployment_digest text NOT NULL,market_id text NOT NULL,rows_count bigint NOT NULL,
 PRIMARY KEY(environment,chain_id,deployment_digest,market_id)
);
CREATE FUNCTION {{schema}}.adjust_holder_ref(e text,c bigint,d text,a text,w text,n bigint) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 INSERT INTO {{schema}}.holder_account_refs VALUES(e,c,d,a,w,n) ON CONFLICT(environment,chain_id,deployment_digest,asset_uid,account) DO UPDATE SET refs={{schema}}.holder_account_refs.refs+excluded.refs;
 DELETE FROM {{schema}}.holder_account_refs WHERE environment=e AND chain_id=c AND deployment_digest=d AND asset_uid=a AND account=w AND refs=0;
 IF EXISTS(SELECT 1 FROM {{schema}}.holder_account_refs WHERE environment=e AND chain_id=c AND deployment_digest=d AND asset_uid=a AND account=w AND refs<0) THEN RAISE EXCEPTION 'negative holder reference count'; END IF;
END $$;
CREATE FUNCTION {{schema}}.track_holder_balance_refs() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r record; n integer; a text;
BEGIN
 IF TG_OP='UPDATE' AND (OLD.environment,OLD.chain_id,OLD.deployment_digest,OLD.market_id,OLD.account,OLD.balance_raw>0) IS NOT DISTINCT FROM (NEW.environment,NEW.chain_id,NEW.deployment_digest,NEW.market_id,NEW.account,NEW.balance_raw>0) THEN RETURN NULL; END IF;
 FOR n IN SELECT unnest(CASE TG_OP WHEN 'UPDATE' THEN ARRAY[-1,1] WHEN 'DELETE' THEN ARRAY[-1] ELSE ARRAY[1] END) LOOP
 IF n=-1 THEN r:=OLD; ELSE r:=NEW; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('holder-asset:'||r.environment||':'||r.chain_id||':'||r.deployment_digest,0));
 INSERT INTO {{schema}}.holder_market_counts VALUES(r.environment,r.chain_id,r.deployment_digest,r.market_id,n) ON CONFLICT(environment,chain_id,deployment_digest,market_id) DO UPDATE SET rows_count={{schema}}.holder_market_counts.rows_count+excluded.rows_count;
 DELETE FROM {{schema}}.holder_market_counts WHERE environment=r.environment AND chain_id=r.chain_id AND deployment_digest=r.deployment_digest AND market_id=r.market_id AND rows_count=0;
 IF r.balance_raw>0 THEN
 PERFORM {{schema}}.adjust_holder_ref(r.environment,r.chain_id,r.deployment_digest,'',r.account,n);
 SELECT asset_uid INTO a FROM {{schema}}.holder_market_assets WHERE environment=r.environment AND chain_id=r.chain_id AND deployment_digest=r.deployment_digest AND market_id=r.market_id;
 IF a IS NOT NULL THEN PERFORM {{schema}}.adjust_holder_ref(r.environment,r.chain_id,r.deployment_digest,a,r.account,n); END IF;
 END IF;
 END LOOP;
 RETURN NULL;
END $$;
CREATE FUNCTION {{schema}}.track_holder_asset() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE old_asset text; next_asset text; r record;
BEGIN
 IF TG_TABLE_NAME='projection_records' THEN IF NEW.scope<>'markets' THEN RETURN NULL; END IF; END IF;
 next_asset:=NEW.payload->>'assetUid'; IF next_asset IS NULL THEN RETURN NULL; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('holder-asset:'||NEW.environment||':'||NEW.chain_id||':'||NEW.deployment_digest,0));
 SELECT asset_uid INTO old_asset FROM {{schema}}.holder_market_assets WHERE environment=NEW.environment AND chain_id=NEW.chain_id AND deployment_digest=NEW.deployment_digest AND market_id=NEW.identity FOR UPDATE;
 IF old_asset IS NOT DISTINCT FROM next_asset THEN RETURN NULL; END IF;
 INSERT INTO {{schema}}.holder_market_assets VALUES(NEW.environment,NEW.chain_id,NEW.deployment_digest,NEW.identity,next_asset) ON CONFLICT(environment,chain_id,deployment_digest,market_id) DO UPDATE SET asset_uid=excluded.asset_uid;
 FOR r IN SELECT account FROM {{schema}}.holder_balances WHERE environment=NEW.environment AND chain_id=NEW.chain_id AND deployment_digest=NEW.deployment_digest AND market_id=NEW.identity AND balance_raw>0 LOOP
 IF old_asset IS NOT NULL THEN PERFORM {{schema}}.adjust_holder_ref(NEW.environment,NEW.chain_id,NEW.deployment_digest,old_asset,r.account,-1); END IF;
 PERFORM {{schema}}.adjust_holder_ref(NEW.environment,NEW.chain_id,NEW.deployment_digest,next_asset,r.account,1);
 END LOOP;
 RETURN NULL;
END $$;
CREATE FUNCTION {{schema}}.track_holder_exclusions() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r record; n integer; a text;
BEGIN
 IF TG_OP='UPDATE' AND (OLD.environment,OLD.chain_id,OLD.deployment_digest,OLD.market_id,OLD.excluded_accounts) IS NOT DISTINCT FROM (NEW.environment,NEW.chain_id,NEW.deployment_digest,NEW.market_id,NEW.excluded_accounts) THEN RETURN NULL; END IF;
 FOR n IN SELECT unnest(CASE TG_OP WHEN 'UPDATE' THEN ARRAY[-1,1] WHEN 'DELETE' THEN ARRAY[-1] ELSE ARRAY[1] END) LOOP
 IF n=-1 THEN r:=OLD; ELSE r:=NEW; END IF;
 FOR a IN SELECT DISTINCT jsonb_array_elements_text(r.excluded_accounts) LOOP
 INSERT INTO {{schema}}.holder_exclusion_refs VALUES(r.environment,r.chain_id,r.deployment_digest,a,n) ON CONFLICT(environment,chain_id,deployment_digest,account) DO UPDATE SET refs={{schema}}.holder_exclusion_refs.refs+excluded.refs;
 DELETE FROM {{schema}}.holder_exclusion_refs WHERE environment=r.environment AND chain_id=r.chain_id AND deployment_digest=r.deployment_digest AND account=a AND refs=0;
 END LOOP;
 END LOOP;
 RETURN NULL;
END $$;
INSERT INTO {{schema}}.holder_market_assets SELECT r.environment,r.chain_id,r.deployment_digest,r.identity,r.payload->>'assetUid' FROM {{schema}}.projection_read_records r JOIN {{schema}}.publication_pointers p USING(environment,chain_id,deployment_digest,scope,revision) WHERE r.scope='markets' AND r.payload->>'assetUid' IS NOT NULL;
INSERT INTO {{schema}}.holder_market_counts SELECT environment,chain_id,deployment_digest,market_id,count(*) FROM {{schema}}.holder_balances GROUP BY environment,chain_id,deployment_digest,market_id;
INSERT INTO {{schema}}.holder_account_refs SELECT environment,chain_id,deployment_digest,'',account,count(*) FROM {{schema}}.holder_balances WHERE balance_raw>0 GROUP BY environment,chain_id,deployment_digest,account;
INSERT INTO {{schema}}.holder_account_refs SELECT b.environment,b.chain_id,b.deployment_digest,a.asset_uid,b.account,count(*) FROM {{schema}}.holder_balances b JOIN {{schema}}.holder_market_assets a USING(environment,chain_id,deployment_digest,market_id) WHERE b.balance_raw>0 GROUP BY b.environment,b.chain_id,b.deployment_digest,a.asset_uid,b.account;
INSERT INTO {{schema}}.holder_exclusion_refs SELECT environment,chain_id,deployment_digest,account,count(*) FROM {{schema}}.holder_snapshots CROSS JOIN LATERAL (SELECT DISTINCT jsonb_array_elements_text(excluded_accounts) account) a GROUP BY environment,chain_id,deployment_digest,account;
CREATE TRIGGER holder_balance_refs AFTER INSERT OR UPDATE OR DELETE ON {{schema}}.holder_balances FOR EACH ROW EXECUTE FUNCTION {{schema}}.track_holder_balance_refs();
CREATE TRIGGER holder_exclusions AFTER INSERT OR UPDATE OR DELETE ON {{schema}}.holder_snapshots FOR EACH ROW EXECUTE FUNCTION {{schema}}.track_holder_exclusions();
CREATE TRIGGER holder_asset_record AFTER INSERT ON {{schema}}.projection_records FOR EACH ROW EXECUTE FUNCTION {{schema}}.track_holder_asset();
CREATE TRIGGER holder_asset_version AFTER INSERT ON {{schema}}.market_record_versions FOR EACH ROW EXECUTE FUNCTION {{schema}}.track_holder_asset();
INSERT INTO {{schema}}.schema_migrations(version) VALUES('0008_holder_counts');
