import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { applyCoreMigration, createDatabasePool, transaction } from '../../packages/db/src/index.ts';

const url = process.env.TG_TEST_DATABASE_URL ?? 'postgresql://127.0.0.1:54329/tickergarden';
const h = (n: number) => `0x${n.toString(16).padStart(64, '0')}`;
const a = (n: number) => `0x${n.toString(16).padStart(40, '0')}`;

test('holder balance statement trigger batches market and asset references', { timeout: 60_000 }, async (ctx) => {
  if (!process.env.TG_TEST_DATABASE_URL) { ctx.skip('TG_TEST_DATABASE_URL is required for the local PostgreSQL integration test'); return; }
  const name = `tg_balance_batch_${randomBytes(6).toString('hex')}`; const s = `"${name}"`;
  const db = createDatabasePool(url, { max: 2 }); const id = ['test', 46630, h(100)]; const wallet = a(1); const asset = h(200);
  try {
    await applyCoreMigration(db.pool, name);
    await db.pool.query(`INSERT INTO ${s}.deployments(environment,chain_id,deployment_digest,genesis_hash,start_block,start_block_hash,abi_digest) VALUES($1,$2,$3,$4,0,$5,$6)`, [...id, h(1), h(2), h(3)]);
    await db.pool.query(`INSERT INTO ${s}.chain_blocks(environment,chain_id,deployment_digest,number,hash,parent_hash,canonical,finalized) VALUES($1,$2,$3,1,$4,$5,true,true)`, [...id, h(11), h(10)]);
    await db.pool.query(`INSERT INTO ${s}.holder_market_assets(environment,chain_id,deployment_digest,market_id,asset_uid) VALUES($1,$2,$3,$4,$5),($1,$2,$3,$6,$5)`, [...id, h(20), asset, h(21)]);
    await db.pool.query(`INSERT INTO ${s}.holder_balances(environment,chain_id,deployment_digest,market_id,account,balance_raw,excluded,block_hash,payload) VALUES($1,$2,$3,$4,$5,10,false,$6,'{}'),($1,$2,$3,$7,$5,20,false,$6,'{}')`, [...id, h(20), wallet, h(11), h(21)]);
    const refs = async () => (await db.pool.query(`SELECT asset_uid,refs FROM ${s}.holder_account_refs ORDER BY asset_uid`)).rows;
    assert.deepEqual(await refs(), [{ asset_uid: '', refs: '2' }, { asset_uid: asset, refs: '2' }]);
    assert.deepEqual((await db.pool.query(`SELECT market_id,rows_count FROM ${s}.holder_market_counts ORDER BY market_id`)).rows, [{ market_id: h(20), rows_count: '1' }, { market_id: h(21), rows_count: '1' }]);
    await db.pool.query(`UPDATE ${s}.holder_balances SET balance_raw=balance_raw+1 WHERE account=$1`, [wallet]);
    assert.deepEqual(await refs(), [{ asset_uid: '', refs: '2' }, { asset_uid: asset, refs: '2' }]);
    await db.pool.query(`UPDATE ${s}.holder_balances SET balance_raw=0 WHERE market_id=$1`, [h(20)]);
    assert.deepEqual(await refs(), [{ asset_uid: '', refs: '1' }, { asset_uid: asset, refs: '1' }]);
    await db.pool.query(`INSERT INTO ${s}.holder_balances(environment,chain_id,deployment_digest,market_id,account,balance_raw,excluded,block_hash,payload) VALUES($1,$2,$3,$4,$5,25,false,$6,'{}') ON CONFLICT(environment,chain_id,deployment_digest,market_id,account) DO UPDATE SET balance_raw=EXCLUDED.balance_raw`, [...id, h(21), wallet, h(11)]);
    assert.deepEqual(await refs(), [{ asset_uid: '', refs: '1' }, { asset_uid: asset, refs: '1' }]);
    await db.pool.query(`DELETE FROM ${s}.holder_balances WHERE account=$1`, [wallet]);
    assert.equal((await refs()).length, 0); assert.equal((await db.pool.query(`SELECT count(*)::int AS n FROM ${s}.holder_market_counts`)).rows[0].n, 0);
    await assert.rejects(transaction(db.pool, async (client) => { await client.query(`INSERT INTO ${s}.holder_balances(environment,chain_id,deployment_digest,market_id,account,balance_raw,excluded,block_hash,payload) VALUES($1,$2,$3,$4,$5,1,false,$6,'{}')`, [...id, h(20), wallet, h(11)]); throw Error('rollback'); }), /rollback/);
    assert.equal((await refs()).length, 0); assert.equal((await db.pool.query(`SELECT count(*)::int AS n FROM ${s}.holder_market_counts`)).rows[0].n, 0);
  } finally { await db.pool.query(`DROP SCHEMA IF EXISTS ${s} CASCADE`).catch(() => undefined); await db.pool.end(); }
});
