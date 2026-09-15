-- Disposable discovery rankings; never used for transaction or settlement decisions.
CREATE TABLE {{schema}}.market_latest_buys (
 environment text NOT NULL,chain_id bigint NOT NULL,deployment_digest text NOT NULL,market_id text NOT NULL,
 position numeric NOT NULL,block_hash text NOT NULL,payload jsonb NOT NULL,
 PRIMARY KEY(environment,chain_id,deployment_digest,market_id)
);
CREATE INDEX market_latest_buys_order ON {{schema}}.market_latest_buys(environment,chain_id,deployment_digest,position DESC,market_id);
CREATE INDEX market_latest_buys_block ON {{schema}}.market_latest_buys(environment,chain_id,deployment_digest,block_hash);
-- This index is used only to repair an affected market after removal/reclassification.
CREATE INDEX market_buy_repair ON {{schema}}.market_trades(environment,chain_id,deployment_digest,market_id,
 ((payload->'source'->>'blockNumber')::numeric) DESC,((payload->'source'->>'transactionIndex')::numeric) DESC,log_index DESC)
 WHERE payload->>'side'='buy' AND classification='unclassified' AND base_raw>0 AND quote_raw>0;
CREATE FUNCTION {{schema}}.refresh_latest_buy(e text,c bigint,d text,m text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 DELETE FROM {{schema}}.market_latest_buys WHERE environment=e AND chain_id=c AND deployment_digest=d AND market_id=m;
 INSERT INTO {{schema}}.market_latest_buys
 SELECT t.environment,t.chain_id,t.deployment_digest,t.market_id,
 b.number::numeric*18446744073709551616+(t.payload->'source'->>'transactionIndex')::numeric*4294967296+t.log_index,
 t.block_hash,jsonb_build_object('blockNumber',b.number::text,'transactionIndex',t.payload->'source'->>'transactionIndex','logIndex',t.log_index::text,'timestamp',t.payload->>'timestamp')
 FROM {{schema}}.market_trades t JOIN {{schema}}.chain_blocks b USING(environment,chain_id,deployment_digest)
 WHERE t.environment=e AND t.chain_id=c AND t.deployment_digest=d AND t.market_id=m AND b.hash=t.block_hash
 AND b.canonical AND b.finalized AND t.payload->>'side'='buy' AND t.classification='unclassified' AND t.base_raw>0 AND t.quote_raw>0
 ORDER BY (t.payload->'source'->>'blockNumber')::numeric DESC,(t.payload->'source'->>'transactionIndex')::numeric DESC,t.log_index DESC LIMIT 1;
END $$;
CREATE FUNCTION {{schema}}.insert_latest_buys() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 -- Serialize canonical changes with event ingestion; the rank table is canonical on commit.
 PERFORM 1 FROM {{schema}}.chain_blocks b WHERE EXISTS(SELECT 1 FROM new_trades t WHERE t.environment=b.environment AND t.chain_id=b.chain_id AND t.deployment_digest=b.deployment_digest AND t.block_hash=b.hash) FOR SHARE OF b;
 INSERT INTO {{schema}}.market_latest_buys
 SELECT DISTINCT ON(t.environment,t.chain_id,t.deployment_digest,t.market_id) t.environment,t.chain_id,t.deployment_digest,t.market_id,
 b.number::numeric*18446744073709551616+(t.payload->'source'->>'transactionIndex')::numeric*4294967296+t.log_index,
 t.block_hash,jsonb_build_object('blockNumber',b.number::text,'transactionIndex',t.payload->'source'->>'transactionIndex','logIndex',t.log_index::text,'timestamp',t.payload->>'timestamp')
 FROM new_trades t JOIN {{schema}}.chain_blocks b ON b.environment=t.environment AND b.chain_id=t.chain_id AND b.deployment_digest=t.deployment_digest AND b.hash=t.block_hash
 WHERE b.canonical AND b.finalized AND t.payload->>'side'='buy' AND t.classification='unclassified' AND t.base_raw>0 AND t.quote_raw>0
 ORDER BY t.environment,t.chain_id,t.deployment_digest,t.market_id,b.number DESC,(t.payload->'source'->>'transactionIndex')::numeric DESC,t.log_index DESC
 ON CONFLICT(environment,chain_id,deployment_digest,market_id) DO UPDATE SET position=excluded.position,block_hash=excluded.block_hash,payload=excluded.payload
 WHERE excluded.position>{{schema}}.market_latest_buys.position;
 RETURN NULL;
END $$;
CREATE FUNCTION {{schema}}.repair_latest_buys() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r record;
BEGIN
 FOR r IN SELECT DISTINCT environment,chain_id,deployment_digest,market_id FROM old_trades LOOP
 PERFORM {{schema}}.refresh_latest_buy(r.environment,r.chain_id,r.deployment_digest,r.market_id);
 END LOOP;
 IF TG_OP='UPDATE' THEN
 FOR r IN SELECT DISTINCT environment,chain_id,deployment_digest,market_id FROM new_trades LOOP
 PERFORM {{schema}}.refresh_latest_buy(r.environment,r.chain_id,r.deployment_digest,r.market_id);
 END LOOP;
 END IF;
 RETURN NULL;
END $$;
CREATE TRIGGER latest_buy_insert AFTER INSERT ON {{schema}}.market_trades REFERENCING NEW TABLE AS new_trades FOR EACH STATEMENT EXECUTE FUNCTION {{schema}}.insert_latest_buys();
CREATE TRIGGER latest_buy_update AFTER UPDATE ON {{schema}}.market_trades REFERENCING OLD TABLE AS old_trades NEW TABLE AS new_trades FOR EACH STATEMENT EXECUTE FUNCTION {{schema}}.repair_latest_buys();
CREATE TRIGGER latest_buy_delete AFTER DELETE ON {{schema}}.market_trades REFERENCING OLD TABLE AS old_trades FOR EACH STATEMENT EXECUTE FUNCTION {{schema}}.repair_latest_buys();
CREATE FUNCTION {{schema}}.repair_buys_after_chain_change() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r record;
BEGIN
 IF (OLD.canonical,OLD.finalized) IS NOT DISTINCT FROM (NEW.canonical,NEW.finalized) THEN RETURN NULL; END IF;
 FOR r IN SELECT DISTINCT market_id FROM {{schema}}.market_trades WHERE environment=NEW.environment AND chain_id=NEW.chain_id AND deployment_digest=NEW.deployment_digest AND block_hash=NEW.hash AND payload->>'side'='buy' LOOP
 PERFORM {{schema}}.refresh_latest_buy(NEW.environment,NEW.chain_id,NEW.deployment_digest,r.market_id);
 END LOOP;
 RETURN NULL;
END $$;
CREATE TRIGGER latest_buy_chain_repair AFTER UPDATE OF canonical,finalized ON {{schema}}.chain_blocks FOR EACH ROW EXECUTE FUNCTION {{schema}}.repair_buys_after_chain_change();
-- One-time existing trade backfill; subsequent inserts update only touched projects.
INSERT INTO {{schema}}.market_latest_buys
 SELECT DISTINCT ON(t.environment,t.chain_id,t.deployment_digest,t.market_id) t.environment,t.chain_id,t.deployment_digest,t.market_id,
 b.number::numeric*18446744073709551616+(t.payload->'source'->>'transactionIndex')::numeric*4294967296+t.log_index,
 t.block_hash,jsonb_build_object('blockNumber',b.number::text,'transactionIndex',t.payload->'source'->>'transactionIndex','logIndex',t.log_index::text,'timestamp',t.payload->>'timestamp')
 FROM {{schema}}.market_trades t JOIN {{schema}}.chain_blocks b ON b.environment=t.environment AND b.chain_id=t.chain_id AND b.deployment_digest=t.deployment_digest AND b.hash=t.block_hash
 WHERE b.canonical AND b.finalized AND t.payload->>'side'='buy' AND t.classification='unclassified' AND t.base_raw>0 AND t.quote_raw>0
 ORDER BY t.environment,t.chain_id,t.deployment_digest,t.market_id,b.number DESC,(t.payload->'source'->>'transactionIndex')::numeric DESC,t.log_index DESC;
CREATE TABLE {{schema}}.market_cap_snapshots (
 environment text NOT NULL,chain_id bigint NOT NULL,deployment_digest text NOT NULL,version text NOT NULL,
 scheduled_at timestamptz NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),revision text NOT NULL,block_hash text NOT NULL,
 PRIMARY KEY(environment,chain_id,deployment_digest,version)
);
CREATE INDEX market_cap_latest ON {{schema}}.market_cap_snapshots(environment,chain_id,deployment_digest,scheduled_at DESC,created_at DESC);
CREATE TABLE {{schema}}.market_cap_ranks (
 environment text NOT NULL,chain_id bigint NOT NULL,deployment_digest text NOT NULL,version text NOT NULL,
 market_id text NOT NULL,rank bigint NOT NULL,asset_uid text NOT NULL,metrics jsonb NOT NULL,
 PRIMARY KEY(environment,chain_id,deployment_digest,version,rank),
 UNIQUE(environment,chain_id,deployment_digest,version,market_id),
 FOREIGN KEY(environment,chain_id,deployment_digest,version) REFERENCES {{schema}}.market_cap_snapshots ON DELETE CASCADE
);
CREATE INDEX market_cap_stock_order ON {{schema}}.market_cap_ranks(environment,chain_id,deployment_digest,version,asset_uid,rank);
INSERT INTO {{schema}}.schema_migrations(version) VALUES('0015_explore_rankings');
