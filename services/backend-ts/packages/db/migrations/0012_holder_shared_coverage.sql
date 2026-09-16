-- Balances change per market; verified coverage advances once per deployment.
-- Both the last mutation and the shared coverage anchor must remain finalized.
CREATE VIEW {{schema}}.holder_snapshots_covered AS
SELECT h.environment,h.chain_id,h.deployment_digest,h.market_id,h.creation_block,
 h.total_supply_raw,h.positive_address_count,h.included_address_count,h.excluded_accounts,
 b.number AS block_number,b.hash AS block_hash,
 h.block_number AS mutation_block_number,h.block_hash AS mutation_block_hash
FROM {{schema}}.holder_snapshots h
JOIN {{schema}}.projection_checkpoints c USING(environment,chain_id,deployment_digest)
JOIN {{schema}}.chain_blocks b ON b.environment=c.environment AND b.chain_id=c.chain_id
 AND b.deployment_digest=c.deployment_digest AND b.number=c.next_block-1
JOIN {{schema}}.chain_blocks mutation ON mutation.environment=h.environment AND mutation.chain_id=h.chain_id
 AND mutation.deployment_digest=h.deployment_digest AND mutation.number=h.block_number AND mutation.hash=h.block_hash
WHERE c.scope='analytics' AND c.last_revision=b.number::text||':'||b.hash
 AND b.canonical AND b.finalized AND mutation.canonical AND mutation.finalized AND h.block_number<=b.number;
INSERT INTO {{schema}}.schema_migrations(version) VALUES('0012_holder_shared_coverage');
