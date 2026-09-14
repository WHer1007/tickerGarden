// Mutates only the retained tg_daily_scale_* fixture after read/browser capacity tests.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {performance} from 'node:perf_hooks';
import {createRequire} from 'node:module';
import {applyCoreMigration,createDatabasePool} from '../../services/backend-ts/packages/db/src/index.ts';
import {publishProjection} from '../../services/backend-ts/packages/projection/src/index.ts';
import {projectF72Markets} from '../../services/backend-ts/packages/market-projector/src/index.ts';
import {projectF72Analytics} from '../../services/backend-ts/packages/analytics-projector/src/index.ts';
import {projectHolderRewards} from '../../services/backend-ts/packages/chain-worker/src/holder-snapshots.ts';
import {CURRENT_RELEASE_ID,f72EventCatalog} from '../../services/backend-ts/packages/events/src/index.ts';
import {snapshotAbis} from '../../services/backend-ts/packages/events/src/f72-abis.generated.ts';
import {dailyRpc} from './daily-rpc.mjs';
const require=createRequire(new URL('../../services/backend-ts/package.json',import.meta.url)),{encodeEventTopics,encodeAbiParameters,getAbiItem,keccak256}=require('viem');
const dir=new URL(process.env.TG_CAPACITY_EVIDENCE_DIR??'../../docs/reviews/evidence/capacity-optimization-2026-09-14/',import.meta.url),meta=JSON.parse(readFileSync(new URL('local-api.json',dir)));
assert.match(meta.schemaName,/^tg_daily_scale_\d+$/);const schemaName=meta.schemaName,s=`"${schemaName}"`,{pool}=createDatabasePool('postgres://tickergarden:tickergarden_dev@127.0.0.1:54329/tickergarden');
const h=n=>'0x'+BigInt(n).toString(16).padStart(64,'0'),a=n=>'0x'+BigInt(n).toString(16).padStart(40,'0'),id=['test',46630,CURRENT_RELEASE_ID],hash4=h(900000),hash5=h(900001);
const deployment={environment:'test',chainId:46630,deploymentDigest:CURRENT_RELEASE_ID,activationBlock:1n},o={pool,deployment,schemaName,generation:0n};
const resume=process.argv.includes('--resume');
const report={scope:'actual incremental projectors at daily population; ABI logs and deterministic dual RPC; no EVM deployment',checks:[]};
if(resume)report.checks=JSON.parse(readFileSync(new URL('daily-incremental.json',dir))).checks.slice(0,1);
async function bulk(sql,rows){for(let i=0;i<rows.length;i+=250)await pool.query(sql,[...id,JSON.stringify(rows.slice(i,i+250))])}
async function logRows(rows){await bulk(`INSERT INTO ${s}.chain_logs(environment,chain_id,deployment_digest,block_hash,transaction_hash,transaction_index,log_index,address,topic0,payload) SELECT $1,$2,$3,x->>'blockHash',x->>'transactionHash',(x->>'transactionIndex')::bigint,(x->>'logIndex')::bigint,x->>'address',x->'topics'->>0,x FROM jsonb_array_elements($4::jsonb) x ON CONFLICT DO NOTHING`,rows)}
function event(abi,name,args,emitter,n,block=1,index=0){const ev=getAbiItem({abi,name}),fields=ev.inputs.filter(x=>!x.indexed);return{address:emitter,blockNumber:String(block),blockHash:h(899996+block),transactionHash:h(5000000+n),transactionIndex:String(n),logIndex:String(index),topics:encodeEventTopics({abi,eventName:name,args}),data:encodeAbiParameters(fields,fields.map(x=>args[x.name])),removed:false}}
try{
 await applyCoreMigration(pool,schemaName);
 const now=Number((await pool.query(`SELECT extract(epoch FROM source_timestamp)::bigint t FROM ${s}.chain_blocks WHERE number=4`)).rows[0].t);
 const markets=(await pool.query(`SELECT payload FROM ${s}.projection_read_records WHERE scope='markets' AND revision=$1 ORDER BY identity`,[meta.revision])).rows.map(x=>x.payload);assert.equal(markets.length,21500);
 for(const m of markets){m.testPoolKey={currency0:a(0),currency1:m.memeToken,fee:m.lpFeePips,tickSpacing:60,hooks:f72EventCatalog.TickerGardenMemeHook.address};m.testPoolId=keccak256(encodeAbiParameters([{type:'tuple',components:[{name:'currency0',type:'address'},{name:'currency1',type:'address'},{name:'fee',type:'uint24'},{name:'tickSpacing',type:'int24'},{name:'hooks',type:'address'}]}],[m.testPoolKey]));}
 // Replace the explicitly SQL-seeded balances with real Transfer replay. Trades remain
 // a separate capacity fixture; this step makes no claim to have indexed those trades.
 let t;
 if(!resume){
 for(const table of ['holder_balances','holder_snapshots'])for(;;){const r=await pool.query(`DELETE FROM ${s}.${table} WHERE ctid IN (SELECT ctid FROM ${s}.${table} LIMIT 1000)`);if(r.rowCount<1000)break;}
 await pool.query(`UPDATE ${s}.projection_checkpoints SET next_block=1 WHERE scope='analytics'`);
 await bulk(`INSERT INTO ${s}.contract_sources(environment,chain_id,deployment_digest,module,address,birth_block,runtime_code_hash,active) SELECT $1,$2,$3,'TickerMemeTokenV1',x->>'memeToken',1,'${h(77)}',true FROM jsonb_array_elements($4::jsonb) x ON CONFLICT DO NOTHING`,markets);
 await logRows(markets.flatMap((m,i)=>[event(snapshotAbis.TickerMemeTokenV1,'Transfer',{from:a(0),to:m.curve,value:10n**27n},m.memeToken,i+1,1,0),event(snapshotAbis.TickerMemeTokenV1,'Transfer',{from:m.curve,to:m.creator,value:10n**18n},m.memeToken,i+1,1,1)]));
 t=performance.now();const analytics=await projectF72Analytics({...o,blockNumber:4n,blockHash:hash4});
 const money=(await pool.query(`SELECT count(*)::int markets,count(*) FILTER(WHERE total=1000000000000000000000000000)::int reconciled FROM (SELECT market_id,sum(balance_raw) total FROM ${s}.holder_balances GROUP BY market_id) q`)).rows[0];assert.deepEqual(money,{markets:21500,reconciled:21500});
 report.checks.push({name:'normal analytics replays 43000 ABI Transfers for 21500 markets and reconciles every supply',pass:true,ms:performance.now()-t,result:analytics,money});

 }
 const nextTimestamp=Math.floor(Date.now()/1000);
 const primary=dailyRpc(markets,nextTimestamp),secondary=dailyRpc(markets,nextTimestamp);
 if(!resume){
 await pool.query(`INSERT INTO ${s}.chain_blocks(environment,chain_id,deployment_digest,number,hash,parent_hash,canonical,finalized,source_timestamp) VALUES($1,$2,$3,5,$4,$5,true,true,to_timestamp($6))`,[...id,hash5,hash4,nextTimestamp]);
 await pool.query(`UPDATE ${s}.covered_ranges SET to_block=5`);await pool.query(`UPDATE ${s}.ingestion_checkpoints SET next_block=6,last_block_hash=$1`,[hash5]);
 await logRows([event(snapshotAbis.TickerMemeTokenV1,'Transfer',{from:markets[0].creator,to:a(888888),value:1n},markets[0].memeToken,100000,5)]);
 }else await pool.query(`DELETE FROM ${s}.projection_observations WHERE block_number=5 AND scope='markets'`);
 t=performance.now();const result=await projectF72Markets({...o,blockNumber:5n,blockHash:hash5,blockTimestamp:BigInt(nextTimestamp),primary,secondary});
 const counts=(await pool.query(`SELECT (SELECT count(*) FROM ${s}.market_record_versions)::int versions,(SELECT count(*) FROM ${s}.projection_read_records WHERE scope='markets' AND revision=$1)::int old,(SELECT count(*) FROM ${s}.projection_read_records WHERE scope='markets' AND revision=$2)::int current`,[meta.revision,`5:${hash5}`])).rows[0];
 assert.deepEqual(counts,{versions:21501,old:21500,current:21500});assert.equal(primary.calls+secondary.calls,50);
 report.checks.push({name:'one changed market observes only one market and adds one immutable version',pass:true,ms:performance.now()-t,rpcCalls:primary.calls+secondary.calls,result,counts});
 assert.equal((await projectF72Markets({...o,blockNumber:5n,blockHash:hash5,blockTimestamp:BigInt(nextTimestamp),primary,secondary})).duplicate,true);
 t=performance.now();const next=await projectF72Analytics({...o,blockNumber:5n,blockHash:hash5});
 assert.equal((await pool.query(`SELECT balance_raw::text FROM ${s}.holder_balances WHERE market_id=$1 AND account=$2`,[markets[0].marketId,a(888888)])).rows[0].balance_raw,'1');
 assert.equal((await pool.query(`SELECT count(*)::int n FROM ${s}.holder_snapshots WHERE block_number=5`)).rows[0].n,1);
 assert.equal((await pool.query(`SELECT count(*)::int n FROM ${s}.holder_snapshots_covered WHERE block_number=5`)).rows[0].n,21500);
 assert.equal((await pool.query(`SELECT count(*)::int n FROM ${s}.holder_snapshots WHERE block_number=4`)).rows[0].n,21499);
 report.checks.push({name:'incremental analytics writes one snapshot and advances shared coverage for 21500 markets',changedSnapshots:1,unchangedSnapshots:21499,pass:true,ms:performance.now()-t,result:next});
 const calls=primary.calls+secondary.calls;t=performance.now();const holder=await projectHolderRewards({...o,blockNumber:5n,blockHash:hash5,primary,secondary});assert.deepEqual(holder,{markets:0,events:0});assert.equal(primary.calls+secondary.calls,calls);
 report.checks.push({name:'unchanged Holder interval performs zero market RPC reads',pass:true,ms:performance.now()-t,result:holder});
 for(const scope of ['configs','accounts','positions']){
  const records=(await pool.query(`SELECT identity,sort_key,payload FROM ${s}.projection_read_records WHERE scope=$1 AND revision=$2`,[scope,meta.revision])).rows;
  await publishProjection({...o,scope,algorithmVersion:'daily-read-fixture-v1',blockNumber:5n,blockHash:hash5,records:records.map(x=>({identity:x.identity,sortKey:x.sort_key,payload:x.payload}))});
 }
 meta.revision=`5:${hash5}`;writeFileSync(new URL('current-api.json',dir),JSON.stringify({...meta,origin:'http://127.0.0.1:18772'}));
 report.pass=true;
}catch(e){report.pass=false;report.error=e.stack;process.exitCode=1}finally{writeFileSync(new URL('daily-incremental.json',dir),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));await pool.end();}
