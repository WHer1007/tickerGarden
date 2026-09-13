-- Confirmed display records are separate from the finalized settlement journal.
CREATE TABLE {{schema}}.recent_markets (
 environment text NOT NULL, chain_id bigint NOT NULL, deployment_digest {{schema}}.hash32 NOT NULL,
 market_id {{schema}}.hash32 NOT NULL, transaction_hash {{schema}}.hash32 NOT NULL,
 block_number bigint NOT NULL CHECK(block_number>=0), block_hash {{schema}}.hash32 NOT NULL,
 canonical boolean NOT NULL DEFAULT true, payload jsonb NOT NULL, initial_detail jsonb,
 observed_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL DEFAULT now()+interval '30 minutes',
 PRIMARY KEY(environment,chain_id,deployment_digest,market_id),
 FOREIGN KEY(environment,chain_id,deployment_digest) REFERENCES {{schema}}.deployments(environment,chain_id,deployment_digest)
);
CREATE INDEX recent_markets_transaction ON {{schema}}.recent_markets(environment,chain_id,deployment_digest,transaction_hash);

INSERT INTO {{schema}}.schema_migrations(version) VALUES ('0003_recent_markets');
