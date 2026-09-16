-- Aggregate common exclusion addresses once per statement. Updating a shared
-- address for every market made a bootstrap transaction accumulate long HOT chains.
LOCK TABLE {{schema}}.holder_snapshots IN SHARE ROW EXCLUSIVE MODE;
DROP TRIGGER holder_exclusions ON {{schema}}.holder_snapshots;
CREATE OR REPLACE FUNCTION {{schema}}.track_holder_exclusions() RETURNS trigger LANGUAGE plpgsql AS $function$
DECLARE source_sql text;
BEGIN
 IF TG_OP='INSERT' THEN
 source_sql:=$source$SELECT r.environment,r.chain_id,r.deployment_digest,a.account,1::bigint delta FROM new_rows r CROSS JOIN LATERAL (SELECT DISTINCT jsonb_array_elements_text(r.excluded_accounts) account) a$source$;
 ELSIF TG_OP='DELETE' THEN
 source_sql:=$source$SELECT r.environment,r.chain_id,r.deployment_digest,a.account,-1::bigint delta FROM old_rows r CROSS JOIN LATERAL (SELECT DISTINCT jsonb_array_elements_text(r.excluded_accounts) account) a$source$;
 ELSE
 source_sql:=$source$
 SELECT r.environment,r.chain_id,r.deployment_digest,a.account,1::bigint delta FROM new_rows r CROSS JOIN LATERAL (SELECT DISTINCT jsonb_array_elements_text(r.excluded_accounts) account) a
 WHERE NOT EXISTS(SELECT 1 FROM old_rows o WHERE o.environment=r.environment AND o.chain_id=r.chain_id AND o.deployment_digest=r.deployment_digest AND o.market_id=r.market_id AND o.excluded_accounts IS NOT DISTINCT FROM r.excluded_accounts)
 UNION ALL
 SELECT r.environment,r.chain_id,r.deployment_digest,a.account,-1::bigint delta FROM old_rows r CROSS JOIN LATERAL (SELECT DISTINCT jsonb_array_elements_text(r.excluded_accounts) account) a
 WHERE NOT EXISTS(SELECT 1 FROM new_rows n WHERE n.environment=r.environment AND n.chain_id=r.chain_id AND n.deployment_digest=r.deployment_digest AND n.market_id=r.market_id AND n.excluded_accounts IS NOT DISTINCT FROM r.excluded_accounts)
 $source$;
 END IF;
 EXECUTE 'INSERT INTO {{schema}}.holder_exclusion_refs SELECT environment,chain_id,deployment_digest,account,sum(delta)::bigint FROM ('||source_sql||') changes GROUP BY environment,chain_id,deployment_digest,account HAVING sum(delta)<>0 ON CONFLICT(environment,chain_id,deployment_digest,account) DO UPDATE SET refs={{schema}}.holder_exclusion_refs.refs+excluded.refs';
 DELETE FROM {{schema}}.holder_exclusion_refs WHERE refs=0;
 RETURN NULL;
END $function$;
CREATE INDEX holder_exclusion_zero ON {{schema}}.holder_exclusion_refs(environment,chain_id,deployment_digest,account) WHERE refs=0;
CREATE TRIGGER holder_exclusions_insert AFTER INSERT ON {{schema}}.holder_snapshots REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION {{schema}}.track_holder_exclusions();
CREATE TRIGGER holder_exclusions_update AFTER UPDATE ON {{schema}}.holder_snapshots REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION {{schema}}.track_holder_exclusions();
CREATE TRIGGER holder_exclusions_delete AFTER DELETE ON {{schema}}.holder_snapshots REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION {{schema}}.track_holder_exclusions();
INSERT INTO {{schema}}.schema_migrations(version) VALUES('0011_holder_batch_exclusions');
