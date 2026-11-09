import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';
import { applyCoreMigration, createDatabasePool, transaction } from '../../packages/db/src/index.ts';
import { coverageFor } from '../../packages/statistics-store/src/index.ts';

const connectionString = process.env.TG_MIGRATION_DATABASE_URL ?? process.env.TG_DATABASE_URL;
const hash = (n: number): `0x${string}` => `0x${n.toString(16).padStart(64, '0')}`;

test('coverage orders numeric blocks across decimal digit boundaries and still rejects real gaps', async context => {
  if (!connectionString) return context.skip('local integration database required');
  const schemaName = `tg_coverage_${randomBytes(6).toString('hex')}`;
  const schema = `"${schemaName}"`;
  const handle = createDatabasePool(connectionString, { max: 2 });
  const d = { environment: 'test' as const, chainId: 46630 as const, deploymentDigest: hash(1), activationBlock: 99_999_998n };
  const point = { number: '100000001', hash: hash(5), asOf: 1_700_000_030 };
  try {
    await applyCoreMigration(handle.pool, schemaName);
    await handle.pool.query(`INSERT INTO ${schema}.deployments(environment,chain_id,deployment_digest,genesis_hash,start_block,start_block_hash,abi_digest) VALUES('test',46630,$1,$2,99999998,$3,$4)`, [d.deploymentDigest, hash(0), hash(2), hash(9)]);
    for (let i = 0; i < 4; i++) await handle.pool.query(`INSERT INTO ${schema}.chain_blocks(environment,chain_id,deployment_digest,number,hash,parent_hash,canonical,finalized,source_timestamp) VALUES('test',46630,$1,$2,$3,$4,true,true,to_timestamp($5))`, [d.deploymentDigest, 99_999_998 + i, hash(i + 2), hash(i + 1), 1_700_000_000 + i * 10]);
    for (const [from, to] of [[99_999_998, 99_999_999], [100_000_000, 100_000_001]]) await handle.pool.query(`INSERT INTO ${schema}.covered_ranges(environment,chain_id,deployment_digest,from_block,to_block,generation,filter_digest,complete,verified_at) VALUES('test',46630,$1,$2,$3,0,$4,true,now())`, [d.deploymentDigest, from, to, hash(9)]);
    await handle.pool.query(`INSERT INTO ${schema}.ingestion_checkpoints(environment,chain_id,deployment_digest,stream,next_block,last_block_hash,generation) VALUES('test',46630,$1,'frontend-events',100000002,$2,0)`, [d.deploymentDigest, hash(5)]);
    await transaction(handle.pool, async client => {
      await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
      // Fail on concurrent submissions to the same transaction connection.
      const query = client.query.bind(client); let active = false;
      client.query = (async (...args: unknown[]) => {
        assert.equal(active, false, 'single connection must execute SQL sequentially'); active = true;
        try { return await (query as Function)(...args); } finally { active = false; }
      }) as typeof client.query;
      try {
        const crossed = await coverageFor(client, schema, d, point, 1_700_000_010, 1_700_000_025);
        assert.equal(crossed.anchorNumber, 99_999_999);
        assert.equal(crossed.throughNumber, 100_000_001);
        const recent = await coverageFor(client, schema, d, point, 1_700_000_025, 1_700_000_030);
        assert.equal(recent.anchorNumber, 100_000_000);
        assert.equal(recent.throughNumber, 100_000_001);
        const old = await coverageFor(client, schema, d, point, 1_700_000_000, 1_700_000_005);
        assert.equal(old.throughNumber, 99_999_999);
      } finally { client.query = query; }
    });
    await assert.rejects(coverageFor(handle.pool, schema, d, point, 1_700_000_020, 1_700_000_031), /not completely covered/);
    await handle.pool.query(`DELETE FROM ${schema}.covered_ranges WHERE from_block=100000000`);
    await assert.rejects(coverageFor(handle.pool, schema, d, point, 1_700_000_010, 1_700_000_030), /coverage gap/);
    await handle.pool.query(`UPDATE ${schema}.covered_ranges SET generation=1`);
    await assert.rejects(coverageFor(handle.pool, schema, d, point, 1_700_000_000, 1_700_000_010), /coverage gap/);
  } finally { await handle.pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); await handle.pool.end(); }
});
