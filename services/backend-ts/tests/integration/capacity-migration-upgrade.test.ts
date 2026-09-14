import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';
import { applyCoreMigration, coreMigrationDigest, createDatabasePool, migrationSql } from '../../packages/db/src/index.ts';

const url = process.env.TG_TEST_DATABASE_URL ?? process.env.TG_DATABASE_URL;
const h = (c: string) => `0x${c.repeat(64)}`;
const a = (c: string) => `0x${c.repeat(40)}`;
const ident = (v: string) => { assert.match(v, /^[a-z][a-z0-9_]{0,62}$/); return `"${v}"`; };

test('upgrade from populated 0005 backfills latest derived state', { timeout: 30_000 }, async (context) => {
  if (!url) { context.skip('TG_TEST_DATABASE_URL or TG_DATABASE_URL is required'); return; }
  const name = `tg_capacity_upgrade_${process.pid}_${randomBytes(4).toString('hex')}`; const s = ident(name);
  const db = createDatabasePool(url, { max: 2 }); const deployment = h('1'); const market = h('2'); const block = h('a');
  try {
    for (const version of ['0001_core','0002_queue_generation_fence','0003_recent_markets','0004_holder_rewards','0005_capacity'] as const) {
      await db.pool.query(migrationSql(name, version));
      await db.pool.query(`UPDATE ${s}.schema_migrations SET digest=$1 WHERE version=$2`, [coreMigrationDigest(version), version]);
    }
    await db.pool.query(`INSERT INTO ${s}.deployments(environment,chain_id,deployment_digest,genesis_hash,start_block,start_block_hash,abi_digest) VALUES('test',46630,$1,$2,1,$3,$4)`, [deployment,h('3'),h('4'),h('5')]);
    await db.pool.query(`INSERT INTO ${s}.chain_blocks(environment,chain_id,deployment_digest,number,hash,parent_hash,canonical,finalized) VALUES('test',46630,$1,1,$2,$3,true,true)`, [deployment,block,h('0')]);
    await db.pool.query(`INSERT INTO ${s}.publications(environment,chain_id,deployment_digest,scope,revision,block_number,block_hash,generation,payload_digest,payload) VALUES('test',46630,$1,'markets','1:${block}',1,$2,0,$3,$4)`, [deployment,block,h('6'),{ storage:'projection-v1' }]);
    await db.pool.query(`INSERT INTO ${s}.projection_records(environment,chain_id,deployment_digest,scope,revision,identity,sort_key,payload_digest,payload) VALUES('test',46630,$1,'markets','1:${block}',$2,$2,$3,$4)`, [deployment,market,h('6'),{ marketId: market, assetUid: h('7') }]);
    await db.pool.query(`INSERT INTO ${s}.publication_pointers(environment,chain_id,deployment_digest,scope,revision) VALUES('test',46630,$1,'markets','1:${block}')`, [deployment]);
    await db.pool.query(`INSERT INTO ${s}.market_trades(environment,chain_id,deployment_digest,market_id,block_hash,transaction_hash,log_index,occurred_at,classification,base_raw,quote_raw,payload) VALUES('test',46630,$1,$2,$3,$4,0,to_timestamp(1000),'unclassified',10,100,$5)`, [deployment,market,block,h('8'),{ feeAsset:a('8'), feeRaw:'7', taxRaw:'2' }]);
    await db.pool.query(`INSERT INTO ${s}.holder_balances(environment,chain_id,deployment_digest,market_id,account,balance_raw,excluded,block_hash,payload) VALUES('test',46630,$1,$2,$3,100,false,$4,'{}'),('test',46630,$1,$2,$5,50,true,$4,'{}')`, [deployment,market,a('9'),block,a('a')]);
    await db.pool.query(`INSERT INTO ${s}.holder_snapshots(environment,chain_id,deployment_digest,market_id,creation_block,total_supply_raw,positive_address_count,included_address_count,excluded_accounts,block_number,block_hash) VALUES('test',46630,$1,$2,1,150,2,1,$3,1,$4)`, [deployment,market,JSON.stringify([a('a')]),block]);
    assert.equal(await applyCoreMigration(db.pool, name), true);
    assert.deepEqual((await db.pool.query(`SELECT bucket_seconds,trade_count,quote_raw::text FROM ${s}.trade_time_buckets ORDER BY bucket_seconds`)).rows, [60,3600,86400].map(bucket_seconds=>({bucket_seconds,trade_count:'1',quote_raw:'100'})));
    assert.deepEqual((await db.pool.query(`SELECT asset_uid,account,refs FROM ${s}.holder_account_refs ORDER BY asset_uid,account`)).rows, [{asset_uid:'',account:a('9'),refs:'1'},{asset_uid:'',account:a('a'),refs:'1'},{asset_uid:h('7'),account:a('9'),refs:'1'},{asset_uid:h('7'),account:a('a'),refs:'1'}]);
    assert.deepEqual((await db.pool.query(`SELECT account,refs FROM ${s}.holder_exclusion_refs`)).rows, [{account:a('a'),refs:'1'}]);
    assert.equal(await applyCoreMigration(db.pool, name), false);
  } finally { await db.pool.query(`DROP SCHEMA IF EXISTS ${s} CASCADE`).catch(() => undefined); await db.pool.end(); }
});
