import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';
import { applyCoreMigration, createDatabasePool } from '../../packages/db/src/index.ts';
import { publishProjection } from '../../packages/projection/src/index.ts';

const url = process.env.TG_TEST_DATABASE_URL ?? process.env.TG_DATABASE_URL;
const h = (c: string): `0x${string}` => `0x${c.repeat(64)}`;
const a = (c: string) => `0x${c.repeat(40)}`;
const ident = (v: string) => { assert.match(v, /^[a-z][a-z0-9_]{0,62}$/); return `"${v}"`; };

test('trade flow rollups remain exact across duplicates, edits, deletes and reorgs', { timeout: 30_000 }, async (context) => {
  if (!url) { context.skip('TG_TEST_DATABASE_URL or TG_DATABASE_URL is required'); return; }
  const schemaName = `tg_rollups_${process.pid}_${randomBytes(4).toString('hex')}`; const s = ident(schemaName);
  const db = createDatabasePool(url, { max: 2 });
  const deployment = { environment: 'test' as const, chainId: 46630 as const, deploymentDigest: h('1'), activationBlock: 1n };
  const marketId = h('2'); const quote = a('3'); const fee2 = a('4'); const tx = h('5');
  const trade = (blockHash: string, occurredAt: string, classification = 'unclassified', feeAsset = quote) => ({
    environment: 'test', chainId: 46630, deploymentDigest: deployment.deploymentDigest, marketId, blockHash,
    transactionHash: tx, logIndex: 0, occurredAt, classification, baseRaw: '10', quoteRaw: '100',
    payload: { feeAsset, feeStatus: 'reported', feeRaw: '7', taxRaw: '2' },
  });
  const insert = async (row: ReturnType<typeof trade>) => db.pool.query(`INSERT INTO ${s}.market_trades(environment,chain_id,deployment_digest,market_id,block_hash,transaction_hash,log_index,occurred_at,classification,base_raw,quote_raw,payload) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT DO NOTHING`, [row.environment,row.chainId,row.deploymentDigest,row.marketId,row.blockHash,row.transactionHash,row.logIndex,row.occurredAt,row.classification,row.baseRaw,row.quoteRaw,row.payload]);
  try {
    await applyCoreMigration(db.pool, schemaName);
    await db.pool.query(`INSERT INTO ${s}.deployments(environment,chain_id,deployment_digest,genesis_hash,start_block,start_block_hash,abi_digest) VALUES('test',46630,$1,$2,1,$3,$4)`, [deployment.deploymentDigest,h('6'),h('0'),h('7')]);
    await db.pool.query(`INSERT INTO ${s}.chain_blocks(environment,chain_id,deployment_digest,number,hash,parent_hash,canonical,finalized,source_timestamp) VALUES('test',46630,$1,1,$2,$3,true,true,to_timestamp(1000)),('test',46630,$1,2,$4,$2,true,true,to_timestamp(2000))`, [deployment.deploymentDigest,h('a'),h('0'),h('b')]);
    await db.pool.query(`INSERT INTO ${s}.covered_ranges(environment,chain_id,deployment_digest,from_block,to_block,filter_digest,complete,verified_at) VALUES('test',46630,$1,1,2,$2,true,now())`, [deployment.deploymentDigest,h('8')]);
    const revision = `2:${h('b')}`;
    await db.pool.query(`INSERT INTO ${s}.projection_checkpoints(environment,chain_id,deployment_digest,scope,algorithm_version,next_block,generation,last_revision) VALUES('test',46630,$1,'analytics','test',3,0,$2)`, [deployment.deploymentDigest,revision]);
    await db.pool.query(`INSERT INTO ${s}.publications(environment,chain_id,deployment_digest,scope,revision,block_number,block_hash,generation,payload_digest,payload) VALUES('test',46630,$1,'markets',$2,2,$3,0,$4,'{}')`, [deployment.deploymentDigest,revision,h('b'),h('9')]);
    await db.pool.query(`INSERT INTO ${s}.projection_records(environment,chain_id,deployment_digest,scope,revision,identity,sort_key,payload_digest,payload) VALUES('test',46630,$1,'markets',$2,$3,$3,$4,$5)`, [deployment.deploymentDigest,revision,marketId,h('a'),{marketId,assetUid:h('6'),quoteAsset:quote,quoteAssetConfigId:h('7'),memeToken:a('8'),launchPhase:0,identity:{name:'Rollup',symbol:'R',deployedAt:'1'}}]);
    await db.pool.query(`INSERT INTO ${s}.publication_pointers(environment,chain_id,deployment_digest,scope,revision) VALUES('test',46630,$1,'markets',$2)`, [deployment.deploymentDigest,revision]);
    const first = trade(h('a'),'1970-01-01T00:16:40Z'); await insert(first); await insert(first);
    let row = await db.pool.query(`SELECT trade_count,quote_raw,fee_raw,tax_raw FROM ${s}.trade_flow_rollups`); assert.deepEqual(row.rows[0], { trade_count: '1', quote_raw: '100', fee_raw: '7', tax_raw: '2' });
    await db.pool.query(`UPDATE ${s}.market_trades SET classification='internal',payload=jsonb_set(jsonb_set(payload,'{feeAsset}',to_jsonb($1::text)),'{feeRaw}',to_jsonb('11'::text)),occurred_at=to_timestamp(1100) WHERE transaction_hash=$2`, [fee2,tx]);
    row = await db.pool.query(`SELECT fee_asset,trade_count,internal_count,unclassified_count,quote_raw,internal_quote_raw,fee_raw FROM ${s}.trade_flow_rollups ORDER BY fee_asset`); assert.deepEqual(row.rows, [{fee_asset:fee2,trade_count:'1',internal_count:'1',unclassified_count:'0',quote_raw:'100',internal_quote_raw:'100',fee_raw:'11'}]);
    await db.pool.query(`DELETE FROM ${s}.market_trades WHERE transaction_hash=$1`, [tx]); assert.equal((await db.pool.query(`SELECT count(*)::int AS n FROM ${s}.trade_flow_rollups`)).rows[0].n, 0);
    await insert(trade(h('a'),'1970-01-01T00:16:40Z')); const canonicalCount = async () => (await db.pool.query(`SELECT count(*)::int AS n FROM ${s}.trade_flow_rollups r JOIN ${s}.chain_blocks b ON b.environment=r.environment AND b.chain_id=r.chain_id AND b.deployment_digest=r.deployment_digest AND b.hash=r.block_hash WHERE r.market_id=$1 AND b.canonical AND b.finalized`, [marketId])).rows[0].n;
    const totals = async () => (await db.pool.query(`SELECT bucket_seconds,trade_count,internal_count,unclassified_count,quote_raw::text,fee_raw::text,tax_raw::text FROM ${s}.trade_time_buckets ORDER BY bucket_seconds`)).rows;
    assert.deepEqual(await totals(), [60,3600,86400].map(bucket_seconds=>({bucket_seconds,trade_count:'1',internal_count:'0',unclassified_count:'1',quote_raw:'100',fee_raw:'7',tax_raw:'2'})));
    for (const [canonical, finalized] of [[true,false],[false,true],[false,false]] as const) { await db.pool.query(`UPDATE ${s}.chain_blocks SET canonical=$1,finalized=$2 WHERE hash=$3`, [canonical, finalized, h('a')]); assert.deepEqual(await totals(), []); }
    await db.pool.query(`UPDATE ${s}.chain_blocks SET canonical=true,finalized=true WHERE hash=$1`, [h('a')]); assert.equal(await canonicalCount(), 1); assert.deepEqual(await totals(), [60,3600,86400].map(bucket_seconds=>({bucket_seconds,trade_count:'1',internal_count:'0',unclassified_count:'1',quote_raw:'100',fee_raw:'7',tax_raw:'2'})));
    // A trade written before finalization must be included exactly once after the lock clears.
    await db.pool.query(`UPDATE ${s}.chain_blocks SET finalized=false WHERE hash=$1`,[h('a')]);
    const writer=await db.pool.connect(),finalizer=await db.pool.connect();
    try{
      await writer.query('BEGIN');
      await writer.query(`UPDATE ${s}.market_trades SET quote_raw=200 WHERE transaction_hash=$1`,[tx]);
      const pid=(await finalizer.query('SELECT pg_backend_pid() pid')).rows[0].pid;
      const completion=finalizer.query(`UPDATE ${s}.chain_blocks SET finalized=true WHERE hash=$1`,[h('a')]);
      let blocked=false;
      for(let i=0;i<50&&!blocked;i++){blocked=(await writer.query('SELECT cardinality(pg_blocking_pids($1))>0 blocked',[pid])).rows[0].blocked;if(!blocked)await new Promise(r=>setTimeout(r,10));}
      assert.equal(blocked,true,'finalization waits for the ineligible block observation lock');
      await writer.query('COMMIT');await completion;
    }finally{await writer.query('ROLLBACK');writer.release();finalizer.release();}
    assert.ok((await totals()).every(r=>r.quote_raw==='200'&&r.trade_count==='1'));
  } finally { await db.pool.query(`DROP SCHEMA IF EXISTS ${s} CASCADE`).catch(() => undefined); await db.pool.end(); }
});
