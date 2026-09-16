-- Disposable display-only results. No settlement or publication code reads this cache.
CREATE TABLE {{schema}}.statistics_cache_versions(environment text NOT NULL,chain_id bigint NOT NULL,deployment_digest text NOT NULL,version bigint NOT NULL DEFAULT 0,PRIMARY KEY(environment,chain_id,deployment_digest));
CREATE TABLE {{schema}}.statistics_result_cache(environment text NOT NULL,chain_id bigint NOT NULL,deployment_digest text NOT NULL,cache_key text NOT NULL,payload jsonb NOT NULL,expires_at timestamptz NOT NULL,PRIMARY KEY(environment,chain_id,deployment_digest,cache_key),CHECK(octet_length(payload::text)<=4194304));
CREATE INDEX statistics_cache_expiry ON {{schema}}.statistics_result_cache(expires_at);
CREATE FUNCTION {{schema}}.invalidate_statistics_cache() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r record;
BEGIN
 IF TG_OP<>'DELETE' THEN
 FOR r IN SELECT DISTINCT environment,chain_id,deployment_digest FROM new_rows LOOP
 INSERT INTO {{schema}}.statistics_cache_versions VALUES(r.environment,r.chain_id,r.deployment_digest,1) ON CONFLICT(environment,chain_id,deployment_digest) DO UPDATE SET version={{schema}}.statistics_cache_versions.version+1;
 END LOOP;
 END IF;
 IF TG_OP<>'INSERT' THEN
 FOR r IN SELECT DISTINCT environment,chain_id,deployment_digest FROM old_rows LOOP
 INSERT INTO {{schema}}.statistics_cache_versions VALUES(r.environment,r.chain_id,r.deployment_digest,1) ON CONFLICT(environment,chain_id,deployment_digest) DO UPDATE SET version={{schema}}.statistics_cache_versions.version+1;
 END LOOP;
 END IF;
 RETURN NULL;
END $$;
CREATE TRIGGER cache_insert AFTER INSERT ON {{schema}}.market_trades REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION {{schema}}.invalidate_statistics_cache();
CREATE TRIGGER cache_update AFTER UPDATE ON {{schema}}.market_trades REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION {{schema}}.invalidate_statistics_cache();
CREATE TRIGGER cache_delete AFTER DELETE ON {{schema}}.market_trades REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION {{schema}}.invalidate_statistics_cache();
CREATE TRIGGER cache_insert AFTER INSERT ON {{schema}}.holder_balances REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION {{schema}}.invalidate_statistics_cache();
CREATE TRIGGER cache_update AFTER UPDATE ON {{schema}}.holder_balances REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION {{schema}}.invalidate_statistics_cache();
CREATE TRIGGER cache_delete AFTER DELETE ON {{schema}}.holder_balances REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION {{schema}}.invalidate_statistics_cache();
CREATE TRIGGER cache_insert AFTER INSERT ON {{schema}}.holder_snapshots REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION {{schema}}.invalidate_statistics_cache();
CREATE TRIGGER cache_update AFTER UPDATE ON {{schema}}.holder_snapshots REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION {{schema}}.invalidate_statistics_cache();
CREATE TRIGGER cache_delete AFTER DELETE ON {{schema}}.holder_snapshots REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION {{schema}}.invalidate_statistics_cache();
CREATE TRIGGER cache_insert AFTER INSERT ON {{schema}}.detail_fee_events REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION {{schema}}.invalidate_statistics_cache();
CREATE TRIGGER cache_update AFTER UPDATE ON {{schema}}.detail_fee_events REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION {{schema}}.invalidate_statistics_cache();
CREATE TRIGGER cache_delete AFTER DELETE ON {{schema}}.detail_fee_events REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION {{schema}}.invalidate_statistics_cache();
CREATE TRIGGER cache_insert AFTER INSERT ON {{schema}}.publication_pointers REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION {{schema}}.invalidate_statistics_cache();
CREATE TRIGGER cache_update AFTER UPDATE ON {{schema}}.publication_pointers REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION {{schema}}.invalidate_statistics_cache();
CREATE TRIGGER cache_delete AFTER DELETE ON {{schema}}.publication_pointers REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION {{schema}}.invalidate_statistics_cache();
CREATE TRIGGER cache_insert AFTER INSERT ON {{schema}}.projection_checkpoints REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION {{schema}}.invalidate_statistics_cache();
CREATE TRIGGER cache_update AFTER UPDATE ON {{schema}}.projection_checkpoints REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION {{schema}}.invalidate_statistics_cache();
CREATE TRIGGER cache_delete AFTER DELETE ON {{schema}}.projection_checkpoints REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION {{schema}}.invalidate_statistics_cache();
CREATE TRIGGER cache_insert AFTER INSERT ON {{schema}}.ingestion_checkpoints REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION {{schema}}.invalidate_statistics_cache();
CREATE TRIGGER cache_update AFTER UPDATE ON {{schema}}.ingestion_checkpoints REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION {{schema}}.invalidate_statistics_cache();
CREATE TRIGGER cache_delete AFTER DELETE ON {{schema}}.ingestion_checkpoints REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION {{schema}}.invalidate_statistics_cache();
CREATE TRIGGER cache_insert AFTER INSERT ON {{schema}}.chain_blocks REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION {{schema}}.invalidate_statistics_cache();
CREATE TRIGGER cache_update AFTER UPDATE ON {{schema}}.chain_blocks REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION {{schema}}.invalidate_statistics_cache();
CREATE TRIGGER cache_delete AFTER DELETE ON {{schema}}.chain_blocks REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION {{schema}}.invalidate_statistics_cache();
CREATE TRIGGER cache_insert AFTER INSERT ON {{schema}}.covered_ranges REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION {{schema}}.invalidate_statistics_cache();
CREATE TRIGGER cache_update AFTER UPDATE ON {{schema}}.covered_ranges REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION {{schema}}.invalidate_statistics_cache();
CREATE TRIGGER cache_delete AFTER DELETE ON {{schema}}.covered_ranges REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION {{schema}}.invalidate_statistics_cache();
INSERT INTO {{schema}}.schema_migrations(version) VALUES('0010_statistics_cache');
