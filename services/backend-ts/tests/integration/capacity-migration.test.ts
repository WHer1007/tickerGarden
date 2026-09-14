import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';
import { applyCoreMigration, coreMigrationDigest, createDatabasePool, migrationSql } from '../../packages/db/src/index.ts';

const url = process.env.TG_TEST_DATABASE_URL ?? process.env.TG_DATABASE_URL;
const address = (c: string) => `0x${c.repeat(40)}`;
const h = (c: string): `0x${string}` => `0x${c.repeat(64)}`;
const ident = (v: string): string => { assert.match(v, /^[a-z][a-z0-9_]{0,62}$/); return `"${v}"`; };

test('0005 capacity migration backfills and continues trade flow rollups', { timeout: 30_000 }, async (context) => {
  if (!url) { context.skip('TG_TEST_DATABASE_URL or TG_DATABASE_URL is required'); return; }
  const schemaName = `tg_capacity_migration_${process.pid}_${randomBytes(4).toString('hex')}`; const s = ident(schemaName);
  const db = createDatabasePool(url, { max: 2 });
  const deployment = h('1'); const market = h('2'); const tx1 = h('3'); const tx2 = h('4');
  try {
    for (const version of ['0001_core', '0002_queue_generation_fence', '0003_recent_markets', '0004_holder_rewards'] as const) {
      await db.pool.query(migrationSql(schemaName, version));
      await db.pool.query(`UPDATE ${s}.schema_migrations SET digest=$1 WHERE version=$2`, [coreMigrationDigest(version), version]);
    }
    await db.pool.query(`INSERT INTO ${s}.deployments(environment,chain_id,deployment_digest,genesis_hash,start_block,start_block_hash,abi_digest) VALUES('test',46630,$1,$2,1,$3,$4)`, [deployment,h('5'),h('6'),h('7')]);
    await db.pool.query(`INSERT INTO ${s}.chain_blocks(environment,chain_id,deployment_digest,number,hash,parent_hash,canonical,finalized,source_timestamp) VALUES('test',46630,$1,1,$2,$3,true,true,to_timestamp(1000))`, [deployment,h('a'),h('0')]);
    const insert = (tx: string, classification: string, feeAsset: string, quote: string, fee: string, tax: string) => db.pool.query(`INSERT INTO ${s}.market_trades(environment,chain_id,deployment_digest,market_id,block_hash,transaction_hash,log_index,occurred_at,classification,base_raw,quote_raw,payload) VALUES('test',46630,$1,$2,$3,$4,0,to_timestamp(1000),$5,$6,$7,$8)`, [deployment,market,h('a'),tx,classification,'1',quote,{feeAsset,feeStatus:'reported',feeRaw:fee,taxRaw:tax}]);
    await insert(tx1, 'unclassified', address('8'), '100', '7', '2');
    await insert(tx2, 'internal', address('9'), '40', '3', '1');
    assert.equal(await applyCoreMigration(db.pool, schemaName), true);
    const old = await db.pool.query(`SELECT fee_asset,trade_count,internal_count,unclassified_count,quote_raw,internal_quote_raw,fee_raw,tax_raw FROM ${s}.trade_flow_rollups ORDER BY fee_asset`);
    assert.deepEqual(old.rows, [
      { fee_asset:address('8'), trade_count:'1', internal_count:'0', unclassified_count:'1', quote_raw:'100', internal_quote_raw:'0', fee_raw:'7', tax_raw:'2' },
      { fee_asset:address('9'), trade_count:'1', internal_count:'1', unclassified_count:'0', quote_raw:'40', internal_quote_raw:'40', fee_raw:'3', tax_raw:'1' },
    ]);
    await insert(h('a'), 'unclassified', address('8'), '60', '5', '0');
    const total = await db.pool.query(`SELECT sum(trade_count)::text trade_count,sum(quote_raw)::text quote_raw,sum(fee_raw)::text fee_raw FROM ${s}.trade_flow_rollups WHERE fee_asset=$1`, [address('8')]);
    assert.deepEqual(total.rows[0], { trade_count:'2', quote_raw:'160', fee_raw:'12' });
    assert.equal(await applyCoreMigration(db.pool, schemaName), false);
    assert.equal((await db.pool.query(`SELECT count(*)::int AS n FROM ${s}.trade_flow_rollups`)).rows[0].n, 2);
  } finally { await db.pool.query(`DROP SCHEMA IF EXISTS ${s} CASCADE`).catch(() => undefined); await db.pool.end(); }
});
