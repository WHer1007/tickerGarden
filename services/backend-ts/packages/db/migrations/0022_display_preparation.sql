-- Durable preparation and rolling-refresh queue. Display only; no settlement changes.
CREATE FUNCTION "{{schema}}".launch_missing_fields(m jsonb,d jsonb) RETURNS text[]
LANGUAGE sql IMMUTABLE AS $$
 SELECT ARRAY(SELECT field FROM (VALUES
 ('identity',m->'identity'),('content',m->'content'),('display',m->'display'),
 ('quoteConfig',m->'quoteAssetConfigId'),('price',d->'statistics'->'price'),
 ('volume',d->'statistics'->'volume24h'),('priceUsd',d->'statistics'->'priceUsd'),
 ('marketCapUsd',d->'statistics'->'marketCapUsd'),('holders',d->'holders'),
 ('chart',d->'chart'),('trades',d->'trades'),('fees',d->'fees')
 ) AS fields(field,value) WHERE value IS NULL OR value='null'::jsonb);
$$;
ALTER TABLE "{{schema}}".confirmed_display_markets
 ADD COLUMN launch_missing text[] GENERATED ALWAYS AS ("{{schema}}".launch_missing_fields(payload->'market',payload->'detailViews'->'1H')) STORED,
 ADD COLUMN refresh_due_at timestamptz NOT NULL DEFAULT now(),
 ADD COLUMN refresh_attempts integer NOT NULL DEFAULT 0,
 ADD COLUMN refresh_error text;
ALTER TABLE "{{schema}}".recent_markets
 ADD COLUMN launch_missing text[] GENERATED ALWAYS AS ("{{schema}}".launch_missing_fields(payload,initial_detail)) STORED,
 ADD COLUMN refresh_due_at timestamptz NOT NULL DEFAULT now(),
 ADD COLUMN refresh_attempts integer NOT NULL DEFAULT 0,
 ADD COLUMN refresh_error text;
CREATE INDEX display_preparation_due ON "{{schema}}".confirmed_display_markets(environment,chain_id,deployment_digest,(cardinality(launch_missing)>0) DESC,refresh_due_at,market_id);
CREATE INDEX recent_preparation_due ON "{{schema}}".recent_markets(environment,chain_id,deployment_digest,refresh_due_at,market_id) WHERE canonical AND cardinality(launch_missing)>0;
CREATE FUNCTION "{{schema}}".schedule_display_refresh() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 NEW.refresh_due_at := now()+CASE WHEN cardinality("{{schema}}".launch_missing_fields(NEW.payload->'market',NEW.payload->'detailViews'->'1H'))>0 THEN interval '5 seconds' ELSE interval '60 seconds' END;
 NEW.refresh_attempts := 0;
 NEW.refresh_error := NULL;
 RETURN NEW;
END;
$$;
CREATE TRIGGER schedule_display_refresh BEFORE INSERT OR UPDATE OF payload ON "{{schema}}".confirmed_display_markets FOR EACH ROW EXECUTE FUNCTION "{{schema}}".schedule_display_refresh();
CREATE TABLE "{{schema}}".display_log_scan (
 environment text NOT NULL,chain_id integer NOT NULL,deployment_digest text NOT NULL,
 from_block bigint NOT NULL,to_block bigint NOT NULL,block_hash text NOT NULL,payload jsonb NOT NULL,
 PRIMARY KEY(environment,chain_id,deployment_digest),CHECK(from_block<=to_block)
);
INSERT INTO "{{schema}}".schema_migrations(version) VALUES('0022_display_preparation');
