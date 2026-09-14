import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { applyCoreMigration, createDatabasePool, transaction } from '../../packages/db/src/index.ts';

const url = process.env.TG_TEST_DATABASE_URL ?? 'postgresql://127.0.0.1:54329/tickergarden';
const h = (n: number) => `0x${n.toString(16).padStart(64, '0')}`;
const a = (n: number) => `0x${n.toString(16).padStart(40, '0')}`;

test('holder shared coverage uses the analytics anchor and preserves atomic rollback', { timeout: 60_000 }, async (ctx) => {
  if (!process.env.TG_TEST_DATABASE_URL) { ctx.skip('TG_TEST_DATABASE_URL is required for the local PostgreSQL integration test'); return; }
  const schemaName = `tg_holder_shared_${randomBytes(6).toString('hex')}`;
  const schema = `"${schemaName}"`;
  const db = createDatabasePool(url, { max: 2 });
  const id = ['test', 46630, h(100)];
  try {
    await applyCoreMigration(db.pool, schemaName);
    await db.pool.query(`INSERT INTO ${schema}.deployments(environment,chain_id,deployment_digest,genesis_hash,start_block,start_block_hash,abi_digest) VALUES($1,$2,$3,$4,0,$5,$6)`, [...id, h(1), h(2), h(3)]);
    for (const [number, hash, parent] of [[1, h(11), h(10)], [2, h(12), h(11)], [3, h(13), h(12)] as const]) {
      await db.pool.query(`INSERT INTO ${schema}.chain_blocks(environment,chain_id,deployment_digest,number,hash,parent_hash,canonical,finalized) VALUES($1,$2,$3,$4,$5,$6,true,true)`, [...id, number, hash, parent]);
    }
    const market = h(20);
    await db.pool.query(`INSERT INTO ${schema}.holder_snapshots(environment,chain_id,deployment_digest,market_id,creation_block,total_supply_raw,positive_address_count,included_address_count,excluded_accounts,block_number,block_hash) VALUES($1,$2,$3,$4,1,100,1,1,'[]',1,$5)`, [...id, market, h(11)]);
    await db.pool.query(`INSERT INTO ${schema}.holder_balances(environment,chain_id,deployment_digest,market_id,account,balance_raw,excluded,block_hash,payload) VALUES($1,$2,$3,$4,$5,100,false,$6,'{}')`, [...id, market, a(1), h(11)]);
    await db.pool.query(`INSERT INTO ${schema}.projection_checkpoints(environment,chain_id,deployment_digest,scope,algorithm_version,next_block,generation,last_revision) VALUES($1,$2,$3,'analytics','test',3,0,$4)`, [...id, `2:${h(12)}`]);

    const first = await db.pool.query(`SELECT block_number::text,block_hash,mutation_block_number::text,mutation_block_hash FROM ${schema}.holder_snapshots_covered`);
    const firstBase = await db.pool.query(`SELECT xmin::text FROM ${schema}.holder_snapshots`);
    assert.equal(first.rows.length, 1);
    assert.deepEqual(first.rows[0], { block_number: '2', block_hash: h(12), mutation_block_number: '1', mutation_block_hash: h(11) });
    const xmin = firstBase.rows[0].xmin;

    await db.pool.query(`UPDATE ${schema}.projection_checkpoints SET next_block=4,last_revision=$1 WHERE scope='analytics'`, [`3:${h(13)}`]);
    const moved = await db.pool.query(`SELECT block_number::text,block_hash,mutation_block_number::text,mutation_block_hash FROM ${schema}.holder_snapshots_covered`);
    const movedBase = await db.pool.query(`SELECT xmin::text FROM ${schema}.holder_snapshots`);
    assert.equal(moved.rows[0]?.block_number, '3');
    assert.equal(moved.rows[0]?.mutation_block_number, '1');
    assert.equal(movedBase.rows[0]?.xmin, xmin);

    for (const [mutationCanonical, mutationFinalized, coverageCanonical, coverageFinalized] of [[false, true, true, true], [true, false, true, true], [true, true, false, true], [true, true, true, false]]) {
      await db.pool.query(`UPDATE ${schema}.chain_blocks SET canonical=$1,finalized=$2 WHERE hash=$3`, [mutationCanonical, mutationFinalized, h(11)]);
      await db.pool.query(`UPDATE ${schema}.chain_blocks SET canonical=$1,finalized=$2 WHERE hash=$3`, [coverageCanonical, coverageFinalized, h(13)]);
      assert.equal((await db.pool.query(`SELECT 1 FROM ${schema}.holder_snapshots_covered`)).rows.length, 0);
      await db.pool.query(`UPDATE ${schema}.chain_blocks SET canonical=true,finalized=true WHERE hash IN ($1,$2)`, [h(11), h(13)]);
      assert.equal((await db.pool.query(`SELECT 1 FROM ${schema}.holder_snapshots_covered`)).rows.length, 1);
    }

    const before = await db.pool.query(`SELECT next_block::text, last_revision, (SELECT balance_raw::text FROM ${schema}.holder_balances) AS balance FROM ${schema}.projection_checkpoints WHERE scope='analytics'`);
    await assert.rejects(async () => transaction(db.pool, async (client) => {
      await client.query(`UPDATE ${schema}.projection_checkpoints SET next_block=2,last_revision=$1 WHERE scope='analytics'`, [`1:${h(11)}`]);
      await client.query(`UPDATE ${schema}.holder_balances SET balance_raw=1`);
      throw new Error('rollback marker');
    }), /rollback marker/);
    const after = await db.pool.query(`SELECT next_block::text, last_revision, (SELECT balance_raw::text FROM ${schema}.holder_balances) AS balance FROM ${schema}.projection_checkpoints WHERE scope='analytics'`);
    assert.deepEqual(after.rows, before.rows);
  } finally {
    await db.pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`).catch(() => undefined);
    await db.pool.end();
  }
});
