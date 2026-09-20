CREATE TABLE "{{schema}}".price_batches (
 environment text NOT NULL, chain_id bigint NOT NULL, deployment_digest "{{schema}}".hash32 NOT NULL,
 revision bigint NOT NULL CHECK(revision>0), updated_at timestamptz NOT NULL,
 PRIMARY KEY(environment,chain_id,deployment_digest),
 FOREIGN KEY(environment,chain_id,deployment_digest) REFERENCES "{{schema}}".deployments(environment,chain_id,deployment_digest)
);
INSERT INTO "{{schema}}".price_batches
SELECT environment,chain_id,deployment_digest,1,max(observed_at)
FROM "{{schema}}".price_references GROUP BY environment,chain_id,deployment_digest;
INSERT INTO "{{schema}}".schema_migrations(version) VALUES('0029_price_batches');
