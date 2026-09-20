-- Content is immutable and shared; publication anchors remain independently auditable.
LOCK TABLE {{schema}}.projection_records,{{schema}}.publications IN ACCESS EXCLUSIVE MODE;
CREATE TABLE {{schema}}.config_contents (
 id bigserial PRIMARY KEY, payload_digest {{schema}}.hash32 NOT NULL UNIQUE,payload jsonb NOT NULL
);
CREATE TABLE {{schema}}.config_sets (
 id bigserial PRIMARY KEY, payload_digest {{schema}}.hash32 NOT NULL UNIQUE
);
CREATE TABLE {{schema}}.config_set_records (
 set_id bigint NOT NULL REFERENCES {{schema}}.config_sets(id),
 identity text NOT NULL,sort_key text NOT NULL,content_id bigint NOT NULL REFERENCES {{schema}}.config_contents(id),
 PRIMARY KEY(set_id,identity)
);
CREATE INDEX config_set_page ON {{schema}}.config_set_records(set_id,sort_key,identity);
CREATE TABLE {{schema}}.config_publication_sets (
 environment text NOT NULL,chain_id bigint NOT NULL,deployment_digest {{schema}}.hash32 NOT NULL,
 scope text NOT NULL DEFAULT 'configs' CHECK(scope='configs'),revision text NOT NULL,
 set_id bigint NOT NULL REFERENCES {{schema}}.config_sets(id),
 PRIMARY KEY(environment,chain_id,deployment_digest,scope,revision),
 FOREIGN KEY(environment,chain_id,deployment_digest,scope,revision) REFERENCES {{schema}}.publications(environment,chain_id,deployment_digest,scope,revision)
);
-- Reject corrupted digest/content pairs instead of silently selecting a winner.
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM {{schema}}.projection_records WHERE scope='configs' GROUP BY payload_digest HAVING count(DISTINCT payload)>1) THEN RAISE EXCEPTION 'config content digest conflict';END IF;
END $$;
INSERT INTO {{schema}}.config_contents(payload_digest,payload)
 SELECT DISTINCT payload_digest,payload FROM {{schema}}.projection_records WHERE scope='configs';
INSERT INTO {{schema}}.config_sets(payload_digest) SELECT DISTINCT payload_digest FROM {{schema}}.publications WHERE scope='configs';
INSERT INTO {{schema}}.config_set_records(set_id,identity,sort_key,content_id)
 SELECT DISTINCT s.id,r.identity,r.sort_key,c.id FROM {{schema}}.projection_records r
 JOIN {{schema}}.publications p USING(environment,chain_id,deployment_digest,scope,revision)
 JOIN {{schema}}.config_sets s ON s.payload_digest=p.payload_digest
 JOIN {{schema}}.config_contents c ON c.payload_digest=r.payload_digest WHERE r.scope='configs';
INSERT INTO {{schema}}.config_publication_sets
 SELECT p.environment,p.chain_id,p.deployment_digest,p.scope,p.revision,s.id FROM {{schema}}.publications p
 JOIN {{schema}}.config_sets s ON s.payload_digest=p.payload_digest WHERE p.scope='configs';
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM {{schema}}.publications p JOIN {{schema}}.config_publication_sets x USING(environment,chain_id,deployment_digest,scope,revision)
 WHERE (p.payload->>'recordCount')::bigint<>(SELECT count(*) FROM {{schema}}.config_set_records r WHERE r.set_id=x.set_id)) THEN RAISE EXCEPTION 'config set population conflict';END IF;
END $$;
-- Transactional rewrite releases historical heap and index space; preserve every other scope.
CREATE TEMP TABLE tg_other_projections ON COMMIT DROP AS SELECT * FROM {{schema}}.projection_records WHERE scope<>'configs';
TRUNCATE {{schema}}.projection_records;
ALTER TABLE {{schema}}.projection_records DISABLE TRIGGER holder_asset_record;
INSERT INTO {{schema}}.projection_records SELECT * FROM tg_other_projections;
ALTER TABLE {{schema}}.projection_records ENABLE TRIGGER holder_asset_record;
ANALYZE {{schema}}.projection_records;
CREATE OR REPLACE VIEW {{schema}}.projection_read_records AS
 SELECT * FROM {{schema}}.projection_records
 UNION ALL
 SELECT v.environment,v.chain_id,v.deployment_digest,p.scope,p.revision,v.identity,v.sort_key,v.payload_digest,v.payload
 FROM {{schema}}.market_record_versions v JOIN {{schema}}.publications p
 ON p.environment=v.environment AND p.chain_id=v.chain_id AND p.deployment_digest=v.deployment_digest AND p.generation=v.generation
 AND p.scope='markets' AND p.payload->>'storage'='market-versions-v1'
 AND v.valid_from<=p.block_number AND (v.valid_to IS NULL OR v.valid_to>p.block_number)
 UNION ALL
 SELECT v.environment,v.chain_id,v.deployment_digest,p.scope,p.revision,v.identity,v.sort_key,v.payload_digest,v.payload
 FROM {{schema}}.principal_record_versions v JOIN {{schema}}.publications p
 ON p.environment=v.environment AND p.chain_id=v.chain_id AND p.deployment_digest=v.deployment_digest AND p.generation=v.generation
 AND p.scope=v.scope AND p.payload->>'storage'='principal-versions-v1'
 AND v.valid_from<=p.block_number AND (v.valid_to IS NULL OR v.valid_to>p.block_number)
 UNION ALL
 SELECT p.environment,p.chain_id,p.deployment_digest,p.scope,p.revision,r.identity,r.sort_key,c.payload_digest,c.payload
 FROM {{schema}}.config_publication_sets p JOIN {{schema}}.config_set_records r ON r.set_id=p.set_id
 JOIN {{schema}}.config_contents c ON c.id=r.content_id;
CREATE TRIGGER config_contents_immutable BEFORE UPDATE OR DELETE ON {{schema}}.config_contents FOR EACH ROW EXECUTE FUNCTION {{schema}}.reject_projection_record_mutation();
CREATE TRIGGER config_sets_immutable BEFORE UPDATE OR DELETE ON {{schema}}.config_sets FOR EACH ROW EXECUTE FUNCTION {{schema}}.reject_projection_record_mutation();
CREATE TRIGGER config_set_records_immutable BEFORE UPDATE OR DELETE ON {{schema}}.config_set_records FOR EACH ROW EXECUTE FUNCTION {{schema}}.reject_projection_record_mutation();
CREATE TRIGGER config_publication_sets_immutable BEFORE UPDATE OR DELETE ON {{schema}}.config_publication_sets FOR EACH ROW EXECUTE FUNCTION {{schema}}.reject_projection_record_mutation();
CREATE FUNCTION {{schema}}.reject_legacy_config_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN IF NEW.scope='configs' THEN RAISE EXCEPTION 'config writer must use content sets';END IF;RETURN NEW;END $$;
CREATE TRIGGER config_writer_version BEFORE INSERT ON {{schema}}.projection_records FOR EACH ROW EXECUTE FUNCTION {{schema}}.reject_legacy_config_snapshot();
INSERT INTO {{schema}}.schema_migrations(version) VALUES('0030_config_sets');
