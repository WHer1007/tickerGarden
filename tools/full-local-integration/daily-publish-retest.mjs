// Latest incremental publisher over the retained daily fixture; local only.
import assert from 'node:assert/strict';import{readFileSync,writeFileSync}from'node:fs';import{performance}from'node:perf_hooks';
import{createRequire}from'node:module';import{createDatabasePool}from'../../services/backend-ts/packages/db/src/index.ts';
import{projectF72Markets}from'../../services/backend-ts/packages/market-projector/src/index.ts';
import{projectF72Analytics}from'../../services/backend-ts/packages/analytics-projector/src/index.ts';
import{projectHolderRewards}from'../../services/backend-ts/packages/chain-worker/src/holder-snapshots.ts';
import{publishProjection}from'../../services/backend-ts/packages/projection/src/index.ts';
import{CURRENT_RELEASE_ID,f72EventCatalog}from'../../services/backend-ts/packages/events/src/index.ts';
import{snapshotAbis}from'../../services/backend-ts/packages/events/src/f72-abis.generated.ts';import{dailyRpc}from'./daily-rpc.mjs';
const require=createRequire(new URL('../../services/backend-ts/package.json',import.meta.url)),{keccak256,encodeAbiParameters,encodeEventTopics}=require('viem');
const dir=new URL(process.env.TG_CAPACITY_EVIDENCE_DIR??'../../docs/reviews/evidence/capacity-optimization-2026-09-14/',import.meta.url),meta=JSON.parse(readFileSync(new URL('current-api.json',dir)));assert.match(meta.schemaName,/^tg_daily_scale_\d+$/);
const {pool}=createDatabasePool('postgres://tickergarden:tickergarden_dev@127.0.0.1:54329/tickergarden'),s=`"${meta.schemaName}"`,h=n=>'0x'+BigInt(n).toString(16).padStart(64,'0'),a=n=>'0x'+BigInt(n).toString(16).padStart(40,'0'),id=['test',46630,CURRENT_RELEASE_ID],block=BigInt(meta.revision.split(':')[0])+1n,hash=h(899996n+block),now=Math.floor(Date.now()/1000),report={checks:[]};
const o={pool,deployment:{environment:'test',chainId:46630,deploymentDigest:CURRENT_RELEASE_ID,activationBlock:1n},schemaName:meta.schemaName,blockNumber:block,blockHash:hash,generation:0n};
try{
 const markets=(await pool.query(`SELECT payload FROM ${s}.projection_read_records WHERE scope='markets' AND revision=$1 ORDER BY identity`,[meta.revision])).rows.map(x=>x.payload);assert.equal(markets.length,21500);
 for(const m of markets){m.testPoolKey={currency0:a(0),currency1:m.memeToken,fee:m.lpFeePips,tickSpacing:60,hooks:f72EventCatalog.TickerGardenMemeHook.address};m.testPoolId=keccak256(encodeAbiParameters([{type:'tuple',components:[{type:'address',name:'currency0'},{type:'address',name:'currency1'},{type:'uint24',name:'fee'},{type:'int24',name:'tickSpacing'},{type:'address',name:'hooks'}]}],[m.testPoolKey]));}
 const primary=dailyRpc(markets,now),secondary=dailyRpc(markets,now),market=markets[0];
 await pool.query(`INSERT INTO ${s}.chain_blocks(environment,chain_id,deployment_digest,number,hash,parent_hash,canonical,finalized,source_timestamp) VALUES($1,$2,$3,$4,$5,$6,true,true,to_timestamp($7))`,[...id,String(block),hash,meta.revision.slice(meta.revision.indexOf(':')+1),now]);
 await pool.query(`UPDATE ${s}.covered_ranges SET to_block=$1`,[String(block)]);await pool.query(`UPDATE ${s}.ingestion_checkpoints SET next_block=$1,last_block_hash=$2`,[String(block+1n),hash]);
 const topics=encodeEventTopics({abi:snapshotAbis.TickerMemeTokenV1,eventName:'Transfer',args:{from:a(888888),to:market.creator}}),log={address:market.memeToken,blockNumber:String(block),blockHash:hash,transactionHash:h(7000000n+block),transactionIndex:'0',logIndex:'0',topics,data:encodeAbiParameters([{type:'uint256'}],[1n]),removed:false};
 await pool.query(`INSERT INTO ${s}.chain_logs(environment,chain_id,deployment_digest,block_hash,transaction_hash,transaction_index,log_index,address,topic0,payload) VALUES($1,$2,$3,$4,$5,0,0,$6,$7,$8)`,[...id,hash,log.transactionHash,log.address,topics[0],log]);
 let t=performance.now();await projectF72Markets({...o,blockTimestamp:BigInt(now),primary,secondary});const ms=performance.now()-t;
 const versions=Number((await pool.query(`SELECT count(*) FROM ${s}.market_record_versions`)).rows[0].count);assert.equal(versions,21502);assert.equal(primary.calls+secondary.calls,50);
 report.checks.push({name:'latest changed-only publisher adds one version at 21500 population',pass:true,ms,versions,rpcCalls:50});
 t=performance.now();const repeat=await projectF72Markets({...o,blockTimestamp:BigInt(now),primary,secondary});assert.equal(repeat.duplicate,true);assert.equal(primary.calls+secondary.calls,50);report.checks.push({name:'duplicate published anchor adds no versions or market RPC reads',pass:true,ms:performance.now()-t});
 await projectF72Analytics(o);await projectHolderRewards({...o,primary,secondary});
 for(const scope of ['configs','accounts','positions']){const rows=(await pool.query(`SELECT identity,sort_key,payload FROM ${s}.projection_read_records WHERE scope=$1 AND revision=$2`,[scope,meta.revision])).rows;await publishProjection({...o,scope,algorithmVersion:'daily-read-fixture-v1',records:rows.map(x=>({identity:x.identity,sortKey:x.sort_key,payload:x.payload}))});}
 meta.revision=`${block}:${hash}`;writeFileSync(new URL('current-api.json',dir),JSON.stringify(meta));report.pass=true;
}catch(e){report.pass=false;report.error=e.stack;process.exitCode=1}finally{writeFileSync(new URL('daily-publish-retest.json',dir),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));await pool.end();}
