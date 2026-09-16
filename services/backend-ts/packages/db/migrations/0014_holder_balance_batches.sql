-- Aggregate reference changes once per SQL statement. Common wallets no longer
-- create one UPDATE/DELETE/probe sequence per market inside a long replay.
LOCK TABLE {{schema}}.holder_balances IN SHARE ROW EXCLUSIVE MODE;
DROP TRIGGER holder_balance_refs ON {{schema}}.holder_balances;
CREATE FUNCTION {{schema}}.track_holder_balance_batch() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE changes jsonb := '[]'::jsonb; r record; minimum_count bigint;
BEGIN
 IF TG_OP IN ('DELETE','UPDATE') THEN
  SELECT coalesce(jsonb_agg(jsonb_build_object('environment',environment,'chain_id',chain_id,'deployment_digest',deployment_digest,'market_id',market_id,'account',account,'positive',balance_raw>0,'n',-1)),'[]'::jsonb) INTO changes FROM old_rows;
 END IF;
 IF TG_OP IN ('INSERT','UPDATE') THEN
  SELECT changes||coalesce(jsonb_agg(jsonb_build_object('environment',environment,'chain_id',chain_id,'deployment_digest',deployment_digest,'market_id',market_id,'account',account,'positive',balance_raw>0,'n',1)),'[]'::jsonb) INTO changes FROM new_rows;
 END IF;
 IF jsonb_array_length(changes)=0 THEN RETURN NULL; END IF;
 FOR r IN SELECT DISTINCT environment,chain_id,deployment_digest FROM jsonb_to_recordset(changes) AS x(environment text,chain_id bigint,deployment_digest text)
  ORDER BY environment,chain_id,deployment_digest LOOP
  PERFORM pg_advisory_xact_lock(hashtextextended('holder-asset:'||r.environment||':'||r.chain_id||':'||r.deployment_digest,0));
 END LOOP;
 WITH deltas AS (
  SELECT environment,chain_id,deployment_digest,market_id,sum(n)::bigint n
  FROM jsonb_to_recordset(changes) AS x(environment text,chain_id bigint,deployment_digest text,market_id text,n integer)
  GROUP BY environment,chain_id,deployment_digest,market_id HAVING sum(n)<>0
 ), written AS (
  INSERT INTO {{schema}}.holder_market_counts SELECT environment,chain_id,deployment_digest,market_id,n FROM deltas
  ON CONFLICT(environment,chain_id,deployment_digest,market_id) DO UPDATE SET rows_count={{schema}}.holder_market_counts.rows_count+excluded.rows_count
  RETURNING rows_count
 ) SELECT min(rows_count) INTO minimum_count FROM written;
 IF minimum_count<0 THEN RAISE EXCEPTION 'negative holder market row count'; END IF;
 DELETE FROM {{schema}}.holder_market_counts WHERE rows_count=0;
 WITH changeset AS (
  SELECT * FROM jsonb_to_recordset(changes) AS x(environment text,chain_id bigint,deployment_digest text,market_id text,account text,positive boolean,n integer) WHERE positive
 ), refs AS (
  SELECT environment,chain_id,deployment_digest,''::text asset_uid,account,n FROM changeset
  UNION ALL
  SELECT c.environment,c.chain_id,c.deployment_digest,a.asset_uid,c.account,c.n FROM changeset c
  JOIN {{schema}}.holder_market_assets a USING(environment,chain_id,deployment_digest,market_id)
 ), deltas AS (
  SELECT environment,chain_id,deployment_digest,asset_uid,account,sum(n)::bigint n FROM refs
  GROUP BY environment,chain_id,deployment_digest,asset_uid,account HAVING sum(n)<>0
 ), written AS (
  INSERT INTO {{schema}}.holder_account_refs SELECT environment,chain_id,deployment_digest,asset_uid,account,n FROM deltas
  ON CONFLICT(environment,chain_id,deployment_digest,asset_uid,account) DO UPDATE SET refs={{schema}}.holder_account_refs.refs+excluded.refs
  RETURNING refs
 ) SELECT min(refs) INTO minimum_count FROM written;
 IF minimum_count<0 THEN RAISE EXCEPTION 'negative holder reference count'; END IF;
 DELETE FROM {{schema}}.holder_account_refs WHERE refs=0;
 RETURN NULL;
END;
$$;
CREATE INDEX holder_account_zero ON {{schema}}.holder_account_refs(environment,chain_id,deployment_digest,asset_uid,account) WHERE refs=0;
CREATE INDEX holder_market_count_zero ON {{schema}}.holder_market_counts(environment,chain_id,deployment_digest,market_id) WHERE rows_count=0;
CREATE TRIGGER holder_balance_batch_insert AFTER INSERT ON {{schema}}.holder_balances REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION {{schema}}.track_holder_balance_batch();
CREATE TRIGGER holder_balance_batch_update AFTER UPDATE ON {{schema}}.holder_balances REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION {{schema}}.track_holder_balance_batch();
CREATE TRIGGER holder_balance_batch_delete AFTER DELETE ON {{schema}}.holder_balances REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION {{schema}}.track_holder_balance_batch();
REVOKE ALL ON FUNCTION {{schema}}.track_holder_balance_batch() FROM PUBLIC;
INSERT INTO {{schema}}.schema_migrations(version) VALUES('0014_holder_balance_batches');
