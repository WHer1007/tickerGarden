CREATE SCHEMA IF NOT EXISTS {{schema}};

CREATE DOMAIN {{schema}}.address AS text CHECK (VALUE ~ '^0x[0-9a-f]{40}$');
CREATE DOMAIN {{schema}}.hash32 AS text CHECK (VALUE ~ '^0x[0-9a-f]{64}$');
CREATE DOMAIN {{schema}}.uint256 AS numeric(78,0) CHECK (VALUE >= 0 AND VALUE < 115792089237316195423570985008687907853269984665640564039457584007913129639936);

CREATE TABLE {{schema}}.schema_migrations (
  version text PRIMARY KEY,
  digest {{schema}}.hash32,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE {{schema}}.deployments (
  environment text NOT NULL CHECK (environment IN ('preview','test','production')),
  chain_id bigint NOT NULL CHECK (chain_id IN (4663,46630)), deployment_digest {{schema}}.hash32 NOT NULL,
  genesis_hash {{schema}}.hash32 NOT NULL, start_block bigint NOT NULL CHECK (start_block >= 0), start_block_hash {{schema}}.hash32 NOT NULL,
  abi_digest {{schema}}.hash32 NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(environment,chain_id,deployment_digest)
);
CREATE TABLE {{schema}}.contract_sources (
  environment text NOT NULL, chain_id bigint NOT NULL, deployment_digest {{schema}}.hash32 NOT NULL,
  module text NOT NULL, address {{schema}}.address NOT NULL, birth_block bigint NOT NULL CHECK (birth_block >= 0),
  runtime_code_hash {{schema}}.hash32 NOT NULL, active boolean NOT NULL DEFAULT true,
  PRIMARY KEY(environment,chain_id,deployment_digest,address),
  FOREIGN KEY(environment,chain_id,deployment_digest) REFERENCES {{schema}}.deployments(environment,chain_id,deployment_digest)
);
CREATE INDEX contract_sources_module ON {{schema}}.contract_sources(environment,chain_id,deployment_digest,module);

CREATE TABLE {{schema}}.chain_blocks (
  environment text NOT NULL, chain_id bigint NOT NULL, deployment_digest {{schema}}.hash32 NOT NULL,
  number bigint NOT NULL CHECK (number >= 0), hash {{schema}}.hash32 NOT NULL, parent_hash {{schema}}.hash32 NOT NULL,
  canonical boolean NOT NULL DEFAULT true, finalized boolean NOT NULL DEFAULT false, source_timestamp timestamptz,
  observed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(environment,chain_id,deployment_digest,hash),
  FOREIGN KEY(environment,chain_id,deployment_digest) REFERENCES {{schema}}.deployments(environment,chain_id,deployment_digest)
);
CREATE UNIQUE INDEX chain_blocks_canonical_height ON {{schema}}.chain_blocks(environment,chain_id,deployment_digest,number) WHERE canonical;
CREATE TABLE {{schema}}.chain_logs (
  environment text NOT NULL, chain_id bigint NOT NULL, deployment_digest {{schema}}.hash32 NOT NULL,
  block_hash {{schema}}.hash32 NOT NULL, transaction_hash {{schema}}.hash32 NOT NULL,
  transaction_index bigint NOT NULL CHECK (transaction_index >= 0), log_index bigint NOT NULL CHECK (log_index >= 0),
  address {{schema}}.address NOT NULL, topic0 {{schema}}.hash32, payload jsonb NOT NULL, canonical boolean NOT NULL DEFAULT true,
  PRIMARY KEY(environment,chain_id,deployment_digest,block_hash,transaction_hash,log_index),
  FOREIGN KEY(environment,chain_id,deployment_digest,block_hash) REFERENCES {{schema}}.chain_blocks(environment,chain_id,deployment_digest,hash)
);
CREATE INDEX chain_logs_address ON {{schema}}.chain_logs(environment,chain_id,deployment_digest,address);
CREATE TABLE {{schema}}.covered_ranges (
  id bigserial PRIMARY KEY, environment text NOT NULL, chain_id bigint NOT NULL, deployment_digest {{schema}}.hash32 NOT NULL,
  from_block bigint NOT NULL CHECK (from_block >= 0), to_block bigint NOT NULL CHECK (to_block >= from_block),
  generation bigint NOT NULL DEFAULT 0 CHECK (generation >= 0), filter_digest {{schema}}.hash32 NOT NULL,
  complete boolean NOT NULL, verified_at timestamptz NOT NULL,
  UNIQUE(environment,chain_id,deployment_digest,from_block,to_block,generation),
  FOREIGN KEY(environment,chain_id,deployment_digest) REFERENCES {{schema}}.deployments(environment,chain_id,deployment_digest)
);

CREATE TABLE {{schema}}.ingestion_checkpoints (
  environment text NOT NULL, chain_id bigint NOT NULL, deployment_digest {{schema}}.hash32 NOT NULL,
  stream text NOT NULL, next_block bigint NOT NULL CHECK (next_block >= 0), last_block_hash {{schema}}.hash32,
  generation bigint NOT NULL DEFAULT 0 CHECK (generation >= 0), updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(environment,chain_id,deployment_digest,stream),
  FOREIGN KEY(environment,chain_id,deployment_digest) REFERENCES {{schema}}.deployments(environment,chain_id,deployment_digest)
);

CREATE TABLE {{schema}}.webhook_configs (
  environment text NOT NULL, chain_id bigint NOT NULL, deployment_digest {{schema}}.hash32 NOT NULL,
  provider text NOT NULL, webhook_id text NOT NULL, network text NOT NULL, query_digest {{schema}}.hash32 NOT NULL,
  query text NOT NULL, status text NOT NULL CHECK (status IN ('planned','active','paused','retired')),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(environment,provider,webhook_id),
  FOREIGN KEY(environment,chain_id,deployment_digest) REFERENCES {{schema}}.deployments(environment,chain_id,deployment_digest)
);

CREATE TABLE {{schema}}.source_conflicts (
  id bigserial PRIMARY KEY, environment text NOT NULL, chain_id bigint NOT NULL, deployment_digest {{schema}}.hash32 NOT NULL,
  block_number bigint NOT NULL CHECK (block_number >= 0), primary_hash {{schema}}.hash32 NOT NULL, secondary_hash {{schema}}.hash32 NOT NULL,
  detected_at timestamptz NOT NULL DEFAULT now(), resolved_at timestamptz,
  FOREIGN KEY(environment,chain_id,deployment_digest) REFERENCES {{schema}}.deployments(environment,chain_id,deployment_digest)
);
CREATE INDEX source_conflicts_open ON {{schema}}.source_conflicts(environment,chain_id,deployment_digest,detected_at) WHERE resolved_at IS NULL;

CREATE TABLE {{schema}}.publications (
  environment text NOT NULL, chain_id bigint NOT NULL, deployment_digest {{schema}}.hash32 NOT NULL, scope text NOT NULL,
  revision text NOT NULL CHECK (revision ~ '^[0-9]+:0x[0-9a-f]{64}$'), block_number bigint NOT NULL CHECK (block_number >= 0),
  block_hash {{schema}}.hash32 NOT NULL, generation bigint NOT NULL CHECK (generation >= 0), payload_digest {{schema}}.hash32 NOT NULL,
  payload jsonb NOT NULL, published_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(environment,chain_id,deployment_digest,scope,revision),
  FOREIGN KEY(environment,chain_id,deployment_digest) REFERENCES {{schema}}.deployments(environment,chain_id,deployment_digest),
  FOREIGN KEY(environment,chain_id,deployment_digest,block_hash) REFERENCES {{schema}}.chain_blocks(environment,chain_id,deployment_digest,hash)
);
CREATE FUNCTION {{schema}}.reject_publication_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'publications are immutable';
END;
$$;
CREATE TRIGGER publications_immutable
BEFORE UPDATE OR DELETE ON {{schema}}.publications
FOR EACH ROW EXECUTE FUNCTION {{schema}}.reject_publication_mutation();
CREATE TABLE {{schema}}.publication_pointers (
  environment text NOT NULL, chain_id bigint NOT NULL, deployment_digest {{schema}}.hash32 NOT NULL, scope text NOT NULL,
  revision text NOT NULL CHECK (revision ~ '^[0-9]+:0x[0-9a-f]{64}$'), updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(environment,chain_id,deployment_digest,scope),
  FOREIGN KEY(environment,chain_id,deployment_digest,scope,revision) REFERENCES {{schema}}.publications(environment,chain_id,deployment_digest,scope,revision)
);

CREATE TABLE {{schema}}.projection_records (
  environment text NOT NULL, chain_id bigint NOT NULL, deployment_digest {{schema}}.hash32 NOT NULL,
  scope text NOT NULL, revision text NOT NULL CHECK (revision ~ '^[0-9]+:0x[0-9a-f]{64}$'),
  identity text NOT NULL, sort_key text NOT NULL, payload_digest {{schema}}.hash32 NOT NULL, payload jsonb NOT NULL,
  PRIMARY KEY(environment,chain_id,deployment_digest,scope,revision,identity),
  FOREIGN KEY(environment,chain_id,deployment_digest,scope,revision)
    REFERENCES {{schema}}.publications(environment,chain_id,deployment_digest,scope,revision)
);
CREATE INDEX projection_records_page ON {{schema}}.projection_records(environment,chain_id,deployment_digest,scope,revision,sort_key,identity);
CREATE FUNCTION {{schema}}.reject_projection_record_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'projection records are immutable';
END;
$$;
CREATE TRIGGER projection_records_immutable
BEFORE UPDATE OR DELETE ON {{schema}}.projection_records
FOR EACH ROW EXECUTE FUNCTION {{schema}}.reject_projection_record_mutation();

CREATE TABLE {{schema}}.projection_checkpoints (
  environment text NOT NULL, chain_id bigint NOT NULL, deployment_digest {{schema}}.hash32 NOT NULL,
  scope text NOT NULL, algorithm_version text NOT NULL, next_block bigint NOT NULL CHECK (next_block >= 0),
  generation bigint NOT NULL CHECK (generation >= 0), last_revision text, updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(environment,chain_id,deployment_digest,scope),
  FOREIGN KEY(environment,chain_id,deployment_digest) REFERENCES {{schema}}.deployments(environment,chain_id,deployment_digest)
);

CREATE TABLE {{schema}}.markets (
  environment text NOT NULL, chain_id bigint NOT NULL, deployment_digest {{schema}}.hash32 NOT NULL, market_id {{schema}}.hash32 NOT NULL,
  asset_uid {{schema}}.hash32 NOT NULL, meme_token {{schema}}.address NOT NULL, quote_asset {{schema}}.address NOT NULL,
  curve {{schema}}.address NOT NULL, gauge {{schema}}.address NOT NULL, creator {{schema}}.address NOT NULL,
  creation_block bigint NOT NULL CHECK (creation_block >= 0), metadata_uri text NOT NULL, payload jsonb NOT NULL,
  PRIMARY KEY(environment,chain_id,deployment_digest,market_id), UNIQUE(environment,chain_id,deployment_digest,meme_token),
  FOREIGN KEY(environment,chain_id,deployment_digest) REFERENCES {{schema}}.deployments(environment,chain_id,deployment_digest)
);
CREATE INDEX markets_creator ON {{schema}}.markets(environment,chain_id,deployment_digest,creator,market_id);
CREATE TABLE {{schema}}.account_facts (
  environment text NOT NULL, chain_id bigint NOT NULL, deployment_digest {{schema}}.hash32 NOT NULL,
  account {{schema}}.address NOT NULL, market_id {{schema}}.hash32 NOT NULL, asset_uid {{schema}}.hash32 NOT NULL,
  free_raw {{schema}}.uint256 NOT NULL, allocated_raw {{schema}}.uint256 NOT NULL, pending_raw {{schema}}.uint256 NOT NULL,
  payload jsonb NOT NULL, PRIMARY KEY(environment,chain_id,deployment_digest,account,market_id,asset_uid),
  FOREIGN KEY(environment,chain_id,deployment_digest) REFERENCES {{schema}}.deployments(environment,chain_id,deployment_digest),
  FOREIGN KEY(environment,chain_id,deployment_digest,market_id) REFERENCES {{schema}}.markets(environment,chain_id,deployment_digest,market_id)
);
CREATE INDEX account_facts_wallet ON {{schema}}.account_facts(environment,chain_id,deployment_digest,account);
CREATE TABLE {{schema}}.display_records (
  id bigserial PRIMARY KEY, environment text NOT NULL, chain_id bigint NOT NULL, deployment_digest {{schema}}.hash32 NOT NULL,
  scope text NOT NULL, identity text NOT NULL, block_number bigint NOT NULL CHECK (block_number >= 0), block_hash {{schema}}.hash32 NOT NULL,
  payload jsonb NOT NULL, UNIQUE(environment,chain_id,deployment_digest,scope,identity),
  FOREIGN KEY(environment,chain_id,deployment_digest) REFERENCES {{schema}}.deployments(environment,chain_id,deployment_digest),
  FOREIGN KEY(environment,chain_id,deployment_digest,block_hash) REFERENCES {{schema}}.chain_blocks(environment,chain_id,deployment_digest,hash)
);
CREATE INDEX display_records_scope ON {{schema}}.display_records(environment,chain_id,deployment_digest,scope,id);
CREATE TABLE {{schema}}.content_objects (
  digest {{schema}}.hash32 PRIMARY KEY, owner {{schema}}.address NOT NULL, media_type text NOT NULL,
  byte_length integer NOT NULL CHECK (byte_length > 0 AND byte_length <= 3145728), object_version text NOT NULL,
  cid text, status text NOT NULL CHECK (status IN ('uploaded','validating','ready','failed')), payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE {{schema}}.content_challenges (
  nonce text PRIMARY KEY CHECK (nonce ~ '^[0-9a-f]{64}$'), account {{schema}}.address NOT NULL,
  content_digest {{schema}}.hash32 NOT NULL, origin text NOT NULL, expires_at timestamptz NOT NULL,
  used boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX content_challenges_account ON {{schema}}.content_challenges(account,created_at DESC);
CREATE TABLE {{schema}}.content_uploads (
  upload_id uuid PRIMARY KEY, operation_digest {{schema}}.hash32 NOT NULL UNIQUE, owner {{schema}}.address NOT NULL,
  origin text NOT NULL, content_digest {{schema}}.hash32 NOT NULL, access_token_digest {{schema}}.hash32 NOT NULL,
  image_digest {{schema}}.hash32, image_media_type text, image_byte_length integer,
  image_object_key text, image_object_version text, metadata_digest {{schema}}.hash32, metadata_cid text,
  status text NOT NULL CHECK (status IN ('awaiting_upload','uploaded','validating','ready','failed')),
  error_code text, payload jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((image_digest IS NULL) = (image_media_type IS NULL)), CHECK ((image_digest IS NULL) = (image_byte_length IS NULL)),
  CHECK (image_byte_length IS NULL OR (image_byte_length > 0 AND image_byte_length <= 2097152))
);
CREATE INDEX content_uploads_owner ON {{schema}}.content_uploads(owner,created_at DESC);

CREATE TABLE {{schema}}.config_records (
  environment text NOT NULL, chain_id bigint NOT NULL, deployment_digest {{schema}}.hash32 NOT NULL,
  kind text NOT NULL CHECK (kind IN ('asset','quote','baseline','template')), config_id {{schema}}.hash32 NOT NULL,
  status bigint NOT NULL CHECK (status >= 0), block_hash {{schema}}.hash32 NOT NULL, values jsonb NOT NULL,
  PRIMARY KEY(environment,chain_id,deployment_digest,kind,config_id),
  FOREIGN KEY(environment,chain_id,deployment_digest) REFERENCES {{schema}}.deployments(environment,chain_id,deployment_digest),
  FOREIGN KEY(environment,chain_id,deployment_digest,block_hash) REFERENCES {{schema}}.chain_blocks(environment,chain_id,deployment_digest,hash)
);
CREATE INDEX config_records_page ON {{schema}}.config_records(environment,chain_id,deployment_digest,kind,config_id);

CREATE TABLE {{schema}}.market_trades (
  environment text NOT NULL, chain_id bigint NOT NULL, deployment_digest {{schema}}.hash32 NOT NULL,
  market_id {{schema}}.hash32 NOT NULL, block_hash {{schema}}.hash32 NOT NULL, transaction_hash {{schema}}.hash32 NOT NULL,
  log_index bigint NOT NULL CHECK (log_index >= 0), occurred_at timestamptz NOT NULL, classification text NOT NULL,
  base_raw {{schema}}.uint256 NOT NULL, quote_raw {{schema}}.uint256 NOT NULL, payload jsonb NOT NULL,
  PRIMARY KEY(environment,chain_id,deployment_digest,block_hash,transaction_hash,log_index),
  FOREIGN KEY(environment,chain_id,deployment_digest,block_hash) REFERENCES {{schema}}.chain_blocks(environment,chain_id,deployment_digest,hash)
);
CREATE INDEX market_trades_page ON {{schema}}.market_trades(environment,chain_id,deployment_digest,market_id,occurred_at DESC,transaction_hash,log_index);

CREATE TABLE {{schema}}.market_candles (
  environment text NOT NULL, chain_id bigint NOT NULL, deployment_digest {{schema}}.hash32 NOT NULL,
  market_id {{schema}}.hash32 NOT NULL, interval text NOT NULL CHECK (interval IN ('1m','5m','15m','1h','4h','1d')),
  starts_at timestamptz NOT NULL, open numeric(78,18) NOT NULL CHECK (open >= 0), high numeric(78,18) NOT NULL CHECK (high >= open),
  low numeric(78,18) NOT NULL CHECK (low >= 0 AND low <= open), close numeric(78,18) NOT NULL CHECK (close >= 0),
  volume_raw {{schema}}.uint256 NOT NULL, trade_count bigint NOT NULL CHECK (trade_count >= 0), complete boolean NOT NULL,
  payload jsonb NOT NULL, PRIMARY KEY(environment,chain_id,deployment_digest,market_id,interval,starts_at)
);

CREATE TABLE {{schema}}.holder_balances (
  environment text NOT NULL, chain_id bigint NOT NULL, deployment_digest {{schema}}.hash32 NOT NULL,
  market_id {{schema}}.hash32 NOT NULL, account {{schema}}.address NOT NULL, balance_raw {{schema}}.uint256 NOT NULL,
  excluded boolean NOT NULL DEFAULT false, block_hash {{schema}}.hash32 NOT NULL, payload jsonb NOT NULL,
  PRIMARY KEY(environment,chain_id,deployment_digest,market_id,account),
  FOREIGN KEY(environment,chain_id,deployment_digest,block_hash) REFERENCES {{schema}}.chain_blocks(environment,chain_id,deployment_digest,hash)
);
CREATE INDEX holder_balances_page ON {{schema}}.holder_balances(environment,chain_id,deployment_digest,market_id,excluded,balance_raw DESC,account);
CREATE TABLE {{schema}}.holder_snapshots (
  environment text NOT NULL, chain_id bigint NOT NULL, deployment_digest {{schema}}.hash32 NOT NULL,
  market_id {{schema}}.hash32 NOT NULL, creation_block bigint NOT NULL CHECK (creation_block >= 0),
  total_supply_raw {{schema}}.uint256 NOT NULL, positive_address_count bigint NOT NULL CHECK (positive_address_count >= 0),
  included_address_count bigint NOT NULL CHECK (included_address_count >= 0 AND included_address_count <= positive_address_count),
  excluded_accounts jsonb NOT NULL, block_number bigint NOT NULL CHECK (block_number >= creation_block), block_hash {{schema}}.hash32 NOT NULL,
  PRIMARY KEY(environment,chain_id,deployment_digest,market_id),
  FOREIGN KEY(environment,chain_id,deployment_digest,block_hash) REFERENCES {{schema}}.chain_blocks(environment,chain_id,deployment_digest,hash)
);
CREATE TABLE {{schema}}.detail_fee_totals (
  environment text NOT NULL, chain_id bigint NOT NULL, deployment_digest {{schema}}.hash32 NOT NULL,
  market_id {{schema}}.hash32 NOT NULL, recipient text NOT NULL CHECK (recipient IN ('creator','stakers','platform','holders')),
  asset {{schema}}.address NOT NULL, amount_raw {{schema}}.uint256 NOT NULL, block_hash {{schema}}.hash32 NOT NULL,
  PRIMARY KEY(environment,chain_id,deployment_digest,market_id,recipient,asset),
  FOREIGN KEY(environment,chain_id,deployment_digest,block_hash) REFERENCES {{schema}}.chain_blocks(environment,chain_id,deployment_digest,hash)
);
CREATE TABLE {{schema}}.detail_fee_events (
  environment text NOT NULL, chain_id bigint NOT NULL, deployment_digest {{schema}}.hash32 NOT NULL,
  market_id {{schema}}.hash32 NOT NULL, recipient text NOT NULL CHECK (recipient IN ('creator','stakers','platform','holders')),
  asset {{schema}}.address NOT NULL, amount_raw {{schema}}.uint256 NOT NULL, block_hash {{schema}}.hash32 NOT NULL,
  transaction_hash {{schema}}.hash32 NOT NULL, log_index bigint NOT NULL CHECK (log_index >= 0),
  PRIMARY KEY(environment,chain_id,deployment_digest,block_hash,transaction_hash,log_index,recipient,asset),
  FOREIGN KEY(environment,chain_id,deployment_digest,block_hash) REFERENCES {{schema}}.chain_blocks(environment,chain_id,deployment_digest,hash)
);
CREATE INDEX detail_fee_events_window ON {{schema}}.detail_fee_events(environment,chain_id,deployment_digest,market_id,block_hash);

CREATE TABLE {{schema}}.user_activity (
  environment text NOT NULL, chain_id bigint NOT NULL, deployment_digest {{schema}}.hash32 NOT NULL,
  account {{schema}}.address NOT NULL, block_hash {{schema}}.hash32 NOT NULL, transaction_hash {{schema}}.hash32 NOT NULL,
  log_index bigint NOT NULL CHECK (log_index >= 0), occurred_at timestamptz NOT NULL, display_only boolean NOT NULL CHECK (display_only),
  payload jsonb NOT NULL, PRIMARY KEY(environment,chain_id,deployment_digest,account,block_hash,transaction_hash,log_index),
  FOREIGN KEY(environment,chain_id,deployment_digest,block_hash) REFERENCES {{schema}}.chain_blocks(environment,chain_id,deployment_digest,hash)
);
CREATE INDEX user_activity_page ON {{schema}}.user_activity(environment,chain_id,deployment_digest,account,occurred_at DESC,transaction_hash,log_index);

CREATE TABLE {{schema}}.transaction_receipts (
  environment text NOT NULL, chain_id bigint NOT NULL, deployment_digest {{schema}}.hash32 NOT NULL,
  transaction_hash {{schema}}.hash32 NOT NULL, block_hash {{schema}}.hash32 NOT NULL, canonical boolean NOT NULL,
  finalized boolean NOT NULL, status text NOT NULL, observed_at timestamptz NOT NULL, payload jsonb NOT NULL,
  PRIMARY KEY(environment,chain_id,deployment_digest,transaction_hash,block_hash),
  FOREIGN KEY(environment,chain_id,deployment_digest,block_hash) REFERENCES {{schema}}.chain_blocks(environment,chain_id,deployment_digest,hash)
);
CREATE INDEX transaction_receipts_lookup ON {{schema}}.transaction_receipts(environment,chain_id,deployment_digest,transaction_hash,canonical DESC,observed_at DESC);

CREATE TABLE {{schema}}.aggregate_records (
  environment text NOT NULL, chain_id bigint NOT NULL, deployment_digest {{schema}}.hash32 NOT NULL,
  scope text NOT NULL, identity text NOT NULL, window_from timestamptz, window_to timestamptz,
  block_hash {{schema}}.hash32 NOT NULL, complete boolean NOT NULL, payload jsonb NOT NULL,
  PRIMARY KEY(environment,chain_id,deployment_digest,scope,identity),
  FOREIGN KEY(environment,chain_id,deployment_digest,block_hash) REFERENCES {{schema}}.chain_blocks(environment,chain_id,deployment_digest,hash)
);
CREATE INDEX aggregate_records_scope ON {{schema}}.aggregate_records(environment,chain_id,deployment_digest,scope,window_from,identity);

CREATE TABLE {{schema}}.price_references (
  environment text NOT NULL, chain_id bigint NOT NULL, deployment_digest {{schema}}.hash32 NOT NULL,
  asset text NOT NULL, source text NOT NULL, status text NOT NULL, value numeric(78,18),
  as_of timestamptz NOT NULL, expires_at timestamptz NOT NULL CHECK (expires_at > as_of), payload jsonb NOT NULL,
  PRIMARY KEY(environment,chain_id,deployment_digest,asset,source,as_of),
  FOREIGN KEY(environment,chain_id,deployment_digest) REFERENCES {{schema}}.deployments(environment,chain_id,deployment_digest)
);
CREATE INDEX price_references_current ON {{schema}}.price_references(environment,chain_id,deployment_digest,asset,expires_at DESC);

CREATE TABLE {{schema}}.reward_history (
  environment text NOT NULL, chain_id bigint NOT NULL, deployment_digest {{schema}}.hash32 NOT NULL,
  kind text NOT NULL CHECK (kind IN ('holder','staker')), market_id {{schema}}.hash32 NOT NULL,
  account {{schema}}.address NOT NULL, asset {{schema}}.address NOT NULL, transaction_hash {{schema}}.hash32 NOT NULL,
  log_index bigint NOT NULL CHECK (log_index >= 0), through_block bigint NOT NULL CHECK (through_block >= 0),
  amount_raw {{schema}}.uint256 NOT NULL, display_only boolean NOT NULL CHECK (display_only), payload jsonb NOT NULL,
  PRIMARY KEY(environment,chain_id,deployment_digest,kind,market_id,account,asset,transaction_hash,log_index)
);
CREATE INDEX reward_history_page ON {{schema}}.reward_history(environment,chain_id,deployment_digest,kind,market_id,account,through_block DESC,transaction_hash,log_index);

CREATE TABLE {{schema}}.invalidations (
  id bigserial PRIMARY KEY, environment text NOT NULL, chain_id bigint NOT NULL, deployment_digest {{schema}}.hash32 NOT NULL,
  scope text NOT NULL, identity text NOT NULL, revision text NOT NULL, reason text NOT NULL, invalidated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(environment,chain_id,deployment_digest) REFERENCES {{schema}}.deployments(environment,chain_id,deployment_digest)
);
CREATE INDEX invalidations_since ON {{schema}}.invalidations(environment,chain_id,deployment_digest,id);

CREATE TABLE {{schema}}.inbox_messages (
  id bigserial PRIMARY KEY, queue text NOT NULL CHECK (queue IN ('chain','content')), external_id text NOT NULL,
  payload_digest {{schema}}.hash32 NOT NULL, raw_body text NOT NULL CHECK (octet_length(raw_body) <= 262144),
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','processed','conflict')),
  received_at timestamptz NOT NULL DEFAULT now(), processed_at timestamptz,
  UNIQUE(queue,external_id)
);
CREATE INDEX inbox_messages_pending ON {{schema}}.inbox_messages(queue,state,id) WHERE state='pending';

CREATE TABLE {{schema}}.jobs (
  id bigserial PRIMARY KEY, operation_id text NOT NULL UNIQUE, queue text NOT NULL CHECK (queue IN ('chain','content')),
  kind text NOT NULL, payload_digest {{schema}}.hash32 NOT NULL, payload jsonb NOT NULL CHECK (octet_length(payload::text) <= 65536),
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','leased','retry','succeeded','dead')),
  generation bigint NOT NULL DEFAULT 0 CHECK (generation >= 0), fencing bigint NOT NULL DEFAULT 0 CHECK (fencing >= 0),
  attempt integer NOT NULL DEFAULT 0 CHECK (attempt >= 0), max_attempts integer NOT NULL DEFAULT 8 CHECK (max_attempts BETWEEN 1 AND 32),
  next_attempt_at timestamptz NOT NULL DEFAULT now(), lease_owner text, lease_expires_at timestamptz,
  result_digest {{schema}}.hash32, last_error_code text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((state='leased') = (lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL))
);
CREATE INDEX jobs_due ON {{schema}}.jobs(queue,next_attempt_at,id) WHERE state IN ('pending','retry');
CREATE INDEX jobs_expired_lease ON {{schema}}.jobs(queue,lease_expires_at,id) WHERE state='leased';

CREATE TABLE {{schema}}.outbox_messages (
  id bigserial PRIMARY KEY, operation_id text NOT NULL REFERENCES {{schema}}.jobs(operation_id),
  queue text NOT NULL CHECK (queue IN ('chain','content')), destination_key text NOT NULL,
  payload_digest {{schema}}.hash32 NOT NULL, payload jsonb NOT NULL CHECK (octet_length(payload::text) <= 65536),
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','leased','retry','sent','dead')),
  fencing bigint NOT NULL DEFAULT 0 CHECK (fencing >= 0), attempt integer NOT NULL DEFAULT 0 CHECK (attempt >= 0),
  max_attempts integer NOT NULL DEFAULT 8 CHECK (max_attempts BETWEEN 1 AND 32), next_attempt_at timestamptz NOT NULL DEFAULT now(),
  lease_owner text, lease_expires_at timestamptz, provider_message_id text, last_error_code text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((state='leased') = (lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL))
);
CREATE INDEX outbox_due ON {{schema}}.outbox_messages(queue,next_attempt_at,id) WHERE state IN ('pending','retry');
CREATE INDEX outbox_expired_lease ON {{schema}}.outbox_messages(queue,lease_expires_at,id) WHERE state='leased';
CREATE UNIQUE INDEX outbox_one_active_delivery ON {{schema}}.outbox_messages(operation_id,destination_key,payload_digest) WHERE state IN ('pending','leased','retry');

CREATE TABLE {{schema}}.job_attempts (
  id bigserial PRIMARY KEY, job_id bigint NOT NULL REFERENCES {{schema}}.jobs(id), queue text NOT NULL CHECK (queue IN ('chain','content')),
  fencing bigint NOT NULL CHECK (fencing > 0), attempt integer NOT NULL CHECK (attempt > 0), outcome text NOT NULL CHECK (outcome IN ('leased','succeeded','retry','dead','expired')),
  error_code text, started_at timestamptz NOT NULL, finished_at timestamptz, UNIQUE(job_id,fencing,outcome)
);
CREATE INDEX job_attempts_job ON {{schema}}.job_attempts(queue,job_id,fencing);

REVOKE ALL ON SCHEMA {{schema}} FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA {{schema}} FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA {{schema}} FROM PUBLIC;

INSERT INTO {{schema}}.schema_migrations(version) VALUES ('0001_core');
