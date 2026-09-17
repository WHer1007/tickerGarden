-- Display-only state. Never used by reward settlement or principal publication.
CREATE TABLE IF NOT EXISTS "{{schema}}".confirmed_display_cursor (
 environment text NOT NULL, chain_id integer NOT NULL, deployment_digest text NOT NULL,
 block_number bigint NOT NULL, block_hash text NOT NULL, base_number bigint NOT NULL, block_timestamp bigint NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(environment,chain_id,deployment_digest)
);
CREATE TABLE IF NOT EXISTS "{{schema}}".confirmed_display_markets (
 environment text NOT NULL, chain_id integer NOT NULL, deployment_digest text NOT NULL, market_id text NOT NULL,
 block_number bigint NOT NULL, block_hash text NOT NULL, payload jsonb NOT NULL,
 PRIMARY KEY(environment,chain_id,deployment_digest,market_id)
);
CREATE TABLE IF NOT EXISTS "{{schema}}".confirmed_display_journal (
 environment text NOT NULL, chain_id integer NOT NULL, deployment_digest text NOT NULL,
 block_number bigint NOT NULL, block_hash text NOT NULL, previous_number bigint NOT NULL, previous_hash text NOT NULL, previous_timestamp bigint NOT NULL,
 undo jsonb NOT NULL, PRIMARY KEY(environment,chain_id,deployment_digest,block_number)
);
INSERT INTO "{{schema}}".schema_migrations(version) VALUES('0019_confirmed_display');
