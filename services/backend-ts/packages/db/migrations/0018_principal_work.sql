-- Durable replay cursor and bounded verification work. Generation isolates reorgs.
CREATE TABLE {{schema}}.principal_candidates (
 environment text NOT NULL, chain_id bigint NOT NULL, deployment_digest text NOT NULL, generation bigint NOT NULL,
 block_number bigint NOT NULL, block_hash text NOT NULL, from_block bigint NOT NULL, base_revision text,
 cursor_block bigint NOT NULL, cursor_tx bigint NOT NULL DEFAULT -1, cursor_log bigint NOT NULL DEFAULT -1,
 phase text NOT NULL DEFAULT 'events' CHECK(phase IN ('events','accounts','positions','published')),
 progress bigint NOT NULL DEFAULT 0, full_audit boolean NOT NULL, last_audit_block bigint NOT NULL,
 evidence_digest text NOT NULL DEFAULT '',
 PRIMARY KEY(environment,chain_id,deployment_digest,generation,block_hash)
);
CREATE UNIQUE INDEX principal_one_candidate ON {{schema}}.principal_candidates(environment,chain_id,deployment_digest,generation) WHERE phase<>'published';
CREATE TABLE {{schema}}.principal_ledger (
 environment text NOT NULL,chain_id bigint NOT NULL,deployment_digest text NOT NULL,generation bigint NOT NULL,
 kind text NOT NULL CHECK(kind IN ('accounts','positions')),identity text NOT NULL,user_address text NOT NULL,asset_uid text NOT NULL,market_id text,
 payload jsonb NOT NULL,
 PRIMARY KEY(environment,chain_id,deployment_digest,generation,kind,identity)
);
CREATE INDEX principal_ledger_account ON {{schema}}.principal_ledger(environment,chain_id,deployment_digest,generation,user_address,asset_uid,kind);
CREATE INDEX principal_ledger_market ON {{schema}}.principal_ledger(environment,chain_id,deployment_digest,generation,market_id) WHERE kind='positions';
CREATE TABLE {{schema}}.principal_work (
 environment text NOT NULL,chain_id bigint NOT NULL,deployment_digest text NOT NULL,generation bigint NOT NULL,block_hash text NOT NULL,
 kind text NOT NULL CHECK(kind IN ('accounts','positions')),identity text NOT NULL,done boolean NOT NULL DEFAULT false,
 PRIMARY KEY(environment,chain_id,deployment_digest,generation,block_hash,kind,identity)
);
CREATE INDEX principal_work_pending ON {{schema}}.principal_work(environment,chain_id,deployment_digest,generation,block_hash,kind,identity) WHERE NOT done;
CREATE TABLE {{schema}}.principal_record_versions (
 environment text NOT NULL,chain_id bigint NOT NULL,deployment_digest text NOT NULL,generation bigint NOT NULL,
 scope text NOT NULL CHECK(scope IN ('accounts','positions')), identity text NOT NULL,valid_from bigint NOT NULL,valid_to bigint,
 sort_key text NOT NULL,payload_digest text NOT NULL,payload jsonb NOT NULL,
 PRIMARY KEY(environment,chain_id,deployment_digest,generation,scope,identity,valid_from),CHECK(valid_to IS NULL OR valid_to>valid_from)
);
CREATE UNIQUE INDEX principal_version_current ON {{schema}}.principal_record_versions(environment,chain_id,deployment_digest,generation,scope,identity) WHERE valid_to IS NULL;
CREATE INDEX principal_version_page ON {{schema}}.principal_record_versions(environment,chain_id,deployment_digest,generation,scope,sort_key,identity,valid_from);
CREATE TRIGGER principal_version_immutable BEFORE UPDATE OR DELETE ON {{schema}}.principal_record_versions FOR EACH ROW EXECUTE FUNCTION {{schema}}.protect_market_version();
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
 AND v.valid_from<=p.block_number AND (v.valid_to IS NULL OR v.valid_to>p.block_number);
INSERT INTO {{schema}}.schema_migrations(version) VALUES('0018_principal_work');
