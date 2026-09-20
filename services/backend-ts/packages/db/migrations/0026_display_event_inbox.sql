-- Speculative display events never establish settlement or complete range coverage.
CREATE TABLE "{{schema}}".display_event_inbox (
 environment text NOT NULL, chain_id integer NOT NULL, deployment_digest text NOT NULL,
 block_number bigint NOT NULL CHECK(block_number>=0), block_hash text NOT NULL,
 transaction_hash text NOT NULL, log_index bigint NOT NULL CHECK(log_index>=0), removed boolean NOT NULL,
 payload jsonb NOT NULL, received_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(environment,chain_id,deployment_digest,block_hash,transaction_hash,log_index,removed)
);
CREATE INDEX display_event_inbox_range ON "{{schema}}".display_event_inbox(environment,chain_id,deployment_digest,block_number);
CREATE TABLE "{{schema}}".display_event_applied (
 environment text NOT NULL, chain_id integer NOT NULL, deployment_digest text NOT NULL,
 block_number bigint NOT NULL, block_hash text NOT NULL, transaction_hash text NOT NULL, log_index bigint NOT NULL,
 PRIMARY KEY(environment,chain_id,deployment_digest,block_hash,transaction_hash,log_index)
);
CREATE INDEX display_event_applied_range ON "{{schema}}".display_event_applied(environment,chain_id,deployment_digest,block_number);
CREATE TABLE "{{schema}}".display_event_coverage (
 environment text NOT NULL, chain_id integer NOT NULL, deployment_digest text NOT NULL,
 block_number bigint NOT NULL, block_hash text NOT NULL, checked_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(environment,chain_id,deployment_digest)
);
INSERT INTO "{{schema}}".schema_migrations(version) VALUES('0026_display_event_inbox');
