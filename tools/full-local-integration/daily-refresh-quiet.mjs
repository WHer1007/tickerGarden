// Append a quiet synthetic finalized block through normal projectors. No fabricated
// wall-clock rewrite of stored immutable market versions; no network RPC.
import assert from 'node:assert/strict';import{performance}from'node:perf_hooks';import{readFileSync,writeFileSync}from'node:fs';
import{createDatabasePool}from'../../services/backend-ts/packages/db/src/index.ts';import{projectF72Markets}from'../../services/backend-ts/packages/market-projector/src/index.ts';import{projectF72Analytics}from'../../services/backend-ts/packages/analytics-projector/src/index.ts';import{projectHolderRewards}from'../../services/backend-ts/packages/chain-worker/src/holder-snapshots.ts';import{publishProjection}from'../../services/backend-ts/packages/projection/src/index.ts';import{CURRENT_RELEASE_ID}from'../../services/backend-ts/packages/events/src/index.ts';
const dir=new URL(process.env.TG_CAPACITY_EVIDENCE_DIR??'../../docs/reviews/evidence/capacity-optimization-2026-09-14/',import.meta.url),meta=JSON.parse(readFileSync(new URL('current-api.json',dir)));assert.match(meta.schemaName,/^tg_daily_scale_\d+$/);
const {pool}=createDatabasePool('postgres://tickergarden:tickergarden_dev@127.0.0.1:54329/tickergarden'),s=`"${meta.schemaName}"`,id=['test',46630,CURRENT_RELEASE_ID],n=BigInt(meta.revision.split(':')[0])+1n,hash='0x'+(899996n+n).toString(16).padStart(64,'0'),parentHash=meta.revision.slice(meta.revision.indexOf(':')+1),timestamp=BigInt(Math.floor(Date.now()/1000));
const rpc={block:async number=>{assert.equal(number,n);return{number,hash,parentHash,timestamp}},callAt:async()=>{throw Error('quiet market must not need contract calls')}};
const o={pool,deployment:{environment:'test',chainId:46630,deploymentDigest:CURRENT_RELEASE_ID,activationBlock:1n},schemaName:meta.schemaName,blockNumber:n,blockHash:hash,blockTimestamp:timestamp,generation:0n,primary:rpc,secondary:rpc};
try{
 const before=Number((await pool.query(`SELECT count(*) FROM ${s}.market_record_versions`)).rows[0].count);
 await pool.query(`INSERT INTO ${s}.chain_blocks(environment,chain_id,deployment_digest,number,hash,parent_hash,canonical,finalized,source_timestamp) VALUES($1,$2,$3,$4,$5,$6,true,true,to_timestamp($7)) ON CONFLICT DO NOTHING`,[...id,String(n),hash,parentHash,String(timestamp)]);
 await pool.query(`UPDATE ${s}.covered_ranges SET to_block=$1`,[String(n)]);await pool.query(`UPDATE ${s}.ingestion_checkpoints SET next_block=$1,last_block_hash=$2`,[String(n+1n),hash]);
 const priorSnapshots=(await pool.query(`SELECT market_id,xmin::text version FROM ${s}.holder_snapshots ORDER BY market_id`)).rows;
 const started=performance.now();await projectF72Markets(o);const marketMs=performance.now()-started;const analyticsStart=performance.now();await projectF72Analytics(o);const analyticsMs=performance.now()-analyticsStart;await projectHolderRewards(o);
 assert.deepEqual((await pool.query(`SELECT market_id,xmin::text version FROM ${s}.holder_snapshots ORDER BY market_id`)).rows,priorSnapshots);
 assert.equal(Number((await pool.query(`SELECT count(*) FROM ${s}.holder_snapshots_covered WHERE block_number=$1`,[String(n)])).rows[0].count),21500);
 for(const scope of ['configs','accounts','positions']){const rows=(await pool.query(`SELECT identity,sort_key,payload FROM ${s}.projection_read_records WHERE scope=$1 AND revision=$2`,[scope,meta.revision])).rows;await publishProjection({...o,scope,algorithmVersion:'daily-read-fixture-v1',records:rows.map(x=>({identity:x.identity,sortKey:x.sort_key,payload:x.payload}))});}
 assert.equal(Number((await pool.query(`SELECT count(*) FROM ${s}.market_record_versions`)).rows[0].count),before);
 meta.revision=`${n}:${hash}`;writeFileSync(new URL('current-api.json',dir),JSON.stringify(meta));writeFileSync(new URL('quiet-block.json',dir),JSON.stringify({pass:true,revision:meta.revision,versions:before,marketRpcCalls:0,marketMs,analyticsMs,holderSnapshotWrites:0,coveredMarkets:21500,timestamp:String(timestamp)}));
}finally{await pool.end()}
