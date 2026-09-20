-- Store common detail fields once and each chart separately. Incoming writer JSON
-- remains compatible; a transaction trigger partitions it before persistence.
CREATE TABLE {{schema}}.confirmed_display_sections (
 environment text NOT NULL,chain_id bigint NOT NULL,deployment_digest text NOT NULL,market_id text NOT NULL,
 section text NOT NULL CHECK(section IN ('common','1H','12H','1D')),payload jsonb NOT NULL,
 PRIMARY KEY(environment,chain_id,deployment_digest,market_id,section),
 FOREIGN KEY(environment,chain_id,deployment_digest,market_id) REFERENCES {{schema}}.confirmed_display_markets(environment,chain_id,deployment_digest,market_id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED
);
ALTER TABLE {{schema}}.confirmed_display_markets ALTER COLUMN launch_missing DROP EXPRESSION;
ALTER TABLE {{schema}}.confirmed_display_markets ADD COLUMN storage_revision bigint NOT NULL DEFAULT 0;
DROP TRIGGER schedule_display_refresh ON {{schema}}.confirmed_display_markets;
CREATE OR REPLACE FUNCTION {{schema}}.schedule_display_refresh() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE views jsonb; row record;
BEGIN
 IF TG_OP='UPDATE' THEN NEW.storage_revision:=OLD.storage_revision+1;END IF;
 views:=NEW.payload->'detailViews';
 IF views IS NOT NULL THEN
  NEW.launch_missing:={{schema}}.launch_missing_fields(NEW.payload->'market',views->'1H');
  FOR row IN SELECT 'common' AS section,(views->'1H')-'chart'-'period' AS payload
   UNION ALL SELECT key,value->'chart' FROM jsonb_each(views)
  LOOP
   INSERT INTO {{schema}}.confirmed_display_sections(environment,chain_id,deployment_digest,market_id,section,payload)
   VALUES(NEW.environment,NEW.chain_id,NEW.deployment_digest,NEW.market_id,row.section,coalesce(row.payload,'null'::jsonb))
   ON CONFLICT(environment,chain_id,deployment_digest,market_id,section) DO UPDATE SET payload=excluded.payload
   WHERE confirmed_display_sections.payload IS DISTINCT FROM excluded.payload;
  END LOOP;
  NEW.payload:=NEW.payload-'detailViews';
 ELSE
  NEW.launch_missing:={{schema}}.launch_missing_fields(NEW.payload->'market',(
   SELECT c.payload || jsonb_build_object('chart',ch.payload) FROM {{schema}}.confirmed_display_sections c
   LEFT JOIN {{schema}}.confirmed_display_sections ch USING(environment,chain_id,deployment_digest,market_id)
   WHERE c.environment=NEW.environment AND c.chain_id=NEW.chain_id AND c.deployment_digest=NEW.deployment_digest AND c.market_id=NEW.market_id AND c.section='common' AND ch.section='1H'));

 END IF;
 NEW.refresh_due_at:=now()+CASE WHEN cardinality(NEW.launch_missing)>0 THEN interval '5 seconds' ELSE interval '60 seconds' END;
 NEW.refresh_attempts:=0;NEW.refresh_error:=NULL;
 RETURN NEW;
END $$;
CREATE TRIGGER schedule_display_refresh BEFORE INSERT OR UPDATE OF payload ON {{schema}}.confirmed_display_markets FOR EACH ROW EXECUTE FUNCTION {{schema}}.schedule_display_refresh();
-- Migrate through the same writer path; unrelated source state remains intact.
UPDATE {{schema}}.confirmed_display_markets SET payload=payload WHERE payload ? 'detailViews';
CREATE FUNCTION {{schema}}.display_detail(m {{schema}}.confirmed_display_markets,p text) RETURNS jsonb LANGUAGE sql STABLE AS $$
 SELECT c.payload || jsonb_build_object('period',p,'chart',ch.payload)
 FROM {{schema}}.confirmed_display_sections c LEFT JOIN {{schema}}.confirmed_display_sections ch
 ON ch.environment=c.environment AND ch.chain_id=c.chain_id AND ch.deployment_digest=c.deployment_digest AND ch.market_id=c.market_id AND ch.section=p
 WHERE c.environment=m.environment AND c.chain_id=m.chain_id AND c.deployment_digest=m.deployment_digest AND c.market_id=m.market_id AND c.section='common';
$$;
CREATE FUNCTION {{schema}}.display_state(m {{schema}}.confirmed_display_markets) RETURNS jsonb LANGUAGE sql STABLE AS $$
 SELECT CASE WHEN c.payload IS NULL THEN m.payload ELSE m.payload || jsonb_build_object('detailViews',
  (SELECT jsonb_object_agg(ch.section,c.payload || jsonb_build_object('period',ch.section,'chart',ch.payload))
   FROM {{schema}}.confirmed_display_sections ch WHERE ch.environment=m.environment AND ch.chain_id=m.chain_id AND ch.deployment_digest=m.deployment_digest AND ch.market_id=m.market_id AND ch.section<>'common')) END
 FROM (SELECT 1) a LEFT JOIN {{schema}}.confirmed_display_sections c ON c.environment=m.environment AND c.chain_id=m.chain_id AND c.deployment_digest=m.deployment_digest AND c.market_id=m.market_id AND c.section='common';
$$;
DROP INDEX {{schema}}.display_rolling_refresh;
-- Stats data version no longer doubles as the sync cursor / refresh clock.
ALTER TABLE {{schema}}.confirmed_display_cursor ADD COLUMN stats_initialized boolean NOT NULL DEFAULT false, ADD COLUMN stats_checked_at timestamptz;
UPDATE {{schema}}.confirmed_display_cursor c SET stats_initialized=true,stats_checked_at=s.generated_at FROM {{schema}}.stats_display_snapshots s
 WHERE c.environment=s.environment AND c.chain_id=s.chain_id AND c.deployment_digest=s.deployment_digest AND c.block_number=s.block_number AND c.block_hash=s.block_hash;
INSERT INTO {{schema}}.schema_migrations(version) VALUES('0031_display_sections');
