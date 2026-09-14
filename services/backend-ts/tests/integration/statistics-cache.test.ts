import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';
import { applyCoreMigration, createDatabasePool } from '../../packages/db/src/index.ts';
import { sharedStatistics } from '../../apps/read-api/src/statistics-cache.ts';
import type { Pool } from 'pg';
import { PublicationUnavailableError } from '../../packages/read-store/src/index.ts';

const connectionString = process.env.TG_TEST_DATABASE_URL ?? process.env.TG_DATABASE_URL;
const hash = (c: string): `0x${string}` => `0x${c.repeat(64)}`;
const address = (c: string): `0x${string}` => `0x${c.repeat(40)}`;
const ident = (v: string) => `"${v}"`;

test('shared statistics cache coalesces pools, invalidates, and fails closed', { timeout: 30_000 }, async (context) => {
  if (!connectionString) { context.skip('TG_TEST_DATABASE_URL or TG_DATABASE_URL is required'); return; }
  const schemaName = `tg_stats_cache_${process.pid}_${randomBytes(4).toString('hex')}`;
  const schema = ident(schemaName);
  const owner = createDatabasePool(connectionString, { max: 3 });
  const poolA = createDatabasePool(connectionString, { max: 1 });
  const poolB = createDatabasePool(connectionString, { max: 1 });
  const deployment = { environment: 'test' as const, chainId: 46630 as const, deploymentDigest: hash('1'), activationBlock: 1n };
  const blockHash = hash('a');
  let calls = 0;
  const build = async (pool: Pool) => { await pool.query('SELECT 1'); calls += 1; await new Promise(resolve => setTimeout(resolve, 30)); return { calls }; };
  try {
    await applyCoreMigration(owner.pool, schemaName);
    await owner.pool.query(`INSERT INTO ${schema}.deployments(environment,chain_id,deployment_digest,genesis_hash,start_block,start_block_hash,abi_digest) VALUES ('test',46630,$1,$2,1,$3,$4)`, [deployment.deploymentDigest, hash('2'), hash('3'), hash('4')]);
    await owner.pool.query(`INSERT INTO ${schema}.chain_blocks(environment,chain_id,deployment_digest,number,hash,parent_hash,canonical,finalized) VALUES ('test',46630,$1,1,$2,$3,true,true)`, [deployment.deploymentDigest, blockHash, hash('0')]);
    await owner.pool.query(`INSERT INTO ${schema}.ingestion_checkpoints(environment,chain_id,deployment_digest,stream,next_block,last_block_hash,generation) VALUES ('test',46630,$1,'frontend-events',2,$2,0)`, [deployment.deploymentDigest, blockHash]);
    await owner.pool.query(`INSERT INTO ${schema}.projection_checkpoints(environment,chain_id,deployment_digest,scope,algorithm_version,next_block,generation,last_revision) VALUES ('test',46630,$1,'analytics','test',2,0,$2)`, [deployment.deploymentDigest, `1:${blockHash}`]);
    const input = (pool: typeof poolA) => ({ pool: pool.pool, deployment, schemaName });
    const [first, second] = await Promise.all([sharedStatistics(input(poolA), 'overview', build), sharedStatistics(input(poolB), 'overview', build)]);
    assert.deepEqual(first, second); assert.equal(calls, 1);
    await owner.pool.query(`INSERT INTO ${schema}.detail_fee_events(environment,chain_id,deployment_digest,market_id,recipient,asset,amount_raw,block_hash,transaction_hash,log_index) VALUES ('test',46630,$1,$2,'creator',$3,1,$4,$5,0)`, [deployment.deploymentDigest, hash('5'), address('6'), blockHash, hash('7')]);
    const afterMutation = await sharedStatistics(input(poolA), 'overview', build); assert.equal(afterMutation.calls, 2);
    await owner.pool.query(`UPDATE ${schema}.ingestion_checkpoints SET generation=1`);
    await assert.rejects(sharedStatistics(input(poolA), 'overview', build), PublicationUnavailableError);
    await owner.pool.query(`UPDATE ${schema}.ingestion_checkpoints SET generation=0`);
    await owner.pool.query(`UPDATE ${schema}.chain_blocks SET canonical=false`);
    await assert.rejects(sharedStatistics(input(poolA), 'overview', build), PublicationUnavailableError);
    await owner.pool.query(`UPDATE ${schema}.chain_blocks SET canonical=true`);
    await owner.pool.query(`DELETE FROM ${schema}.projection_checkpoints`);
    await assert.rejects(sharedStatistics(input(poolA), 'overview', build), PublicationUnavailableError);
  } finally {
    await owner.pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`).catch(() => undefined);
    await Promise.all([owner.pool.end(), poolA.pool.end(), poolB.pool.end()]);
  }
});
