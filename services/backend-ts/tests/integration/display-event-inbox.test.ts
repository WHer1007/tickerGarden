import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import test from 'node:test';
import {applyCoreMigration,createDatabasePool} from '../../packages/db/src/index.ts';
import {encodeAbiParameters,encodeEventTopics} from 'viem';
import type {DeploymentIdentity,RpcLog,RpcTransport} from '../../packages/chain/src/index.ts';
import {eventTopic,eventTopicsForModules,fixedF72Sources,protocolEventAbi} from '../../packages/events/src/index.ts';
import {commitEventCoverage,initializeEventCoverage,planDisplayEvents,readDisplayEvents,saveAppliedEvents} from '../../packages/confirmed-display/src/inbox.ts';

const databaseUrl=process.env.TG_TEST_DISPLAY_DATABASE_URL??'postgresql:///postgres?host=/tmp';
const database=new URL(databaseUrl);const host=database.searchParams.get('host')??database.hostname;if(!['/tmp','localhost','127.0.0.1','::1'].includes(host))throw Error('Inbox tests require local PostgreSQL');
const h=(c:string)=>`0x${c.repeat(64)}` as `0x${string}`;
const a=(c:string)=>`0x${c.repeat(40)}` as `0x${string}`;
const schemaIdent=(name:string)=>`"${name}"`;
const deployment=(n:number):DeploymentIdentity=>({environment:'test',chainId:46630,deploymentDigest:h(n.toString(16).padStart(1,'0')),activationBlock:1n});
function rpc(blockHashes:Map<bigint,string>,logs:RpcLog[]=[],onGetLogs?:()=>void):RpcTransport{
 return {block:async(number:bigint)=>({number,hash:(blockHashes.get(number)??h('a')) as `0x${string}`,parentHash:h('b'),timestamp:1000n+number}),logs:async()=>[],call:async(method:string)=>{if(method==='eth_getLogs'){onGetLogs?.();return logs;}throw Error(`unexpected RPC method ${method}`);}} as unknown as RpcTransport;
}
function log(blockNumber:bigint,blockHash:string,index:bigint):RpcLog{return {address:a('1'),blockHash:blockHash as `0x${string}`,blockNumber,transactionHash:h('2'),transactionIndex:0n,logIndex:index,data:'0x',topics:[h('3')],removed:false};}
function marketCreatedLog(n:string,blockNumber:bigint,blockHash:string,index:bigint):RpcLog{
 const digit=(offset:number)=>(Number.parseInt(n,16)+offset).toString(16);
 const marketId=h(n),assetUid=h(digit(1)),memeToken=a(digit(2)),curve=a(digit(3)),gauge=a(digit(4)),quoteAsset=a('0'),baseline=h('5'),quoteConfig=h('6'),economics=h('7');
 const topics=encodeEventTopics({abi:protocolEventAbi('TickerGardenFactoryV1'),eventName:'MarketCreated',args:{marketId,assetUid,memeToken}}) as `0x${string}`[];
 assert.equal(topics[0],eventTopic('TickerGardenFactoryV1','MarketCreated'));
 const data=encodeAbiParameters([{type:'address'},{type:'address'},{type:'address'},{type:'bytes32'},{type:'bytes32'},{type:'bytes32'}],[curve,gauge,quoteAsset,baseline,quoteConfig,economics]);
 const factory=fixedF72Sources().find(source=>source.module==='TickerGardenFactoryV1')!;
 return {...log(blockNumber,blockHash,index),address:factory.address,data,topics};
}
async function insertInbox(client:any,schema:string,d:DeploymentIdentity,logs:RpcLog[],removed=false){
 for(const entry of logs){
  const payload={address:entry.address,blockHash:entry.blockHash,blockNumber:`0x${entry.blockNumber.toString(16)}`,transactionHash:entry.transactionHash,transactionIndex:`0x${entry.transactionIndex.toString(16)}`,logIndex:`0x${entry.logIndex.toString(16)}`,data:entry.data,topics:entry.topics,removed};
  await client.query(`INSERT INTO ${schema}.display_event_inbox(environment,chain_id,deployment_digest,block_number,block_hash,transaction_hash,log_index,removed,payload) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT DO NOTHING`,[d.environment,d.chainId,d.deploymentDigest,entry.blockNumber.toString(),entry.blockHash,entry.transactionHash,entry.logIndex.toString(),removed,JSON.stringify(payload)]);
 }
}
async function setCoverage(client:any,schema:string,d:DeploymentIdentity,number:bigint,blockHash:string,checkedAt='now()'){
 await client.query(`INSERT INTO ${schema}.display_event_coverage(environment,chain_id,deployment_digest,block_number,block_hash,checked_at) VALUES($1,$2,$3,$4,$5,${checkedAt}) ON CONFLICT(environment,chain_id,deployment_digest) DO UPDATE SET block_number=excluded.block_number,block_hash=excluded.block_hash,checked_at=excluded.checked_at`,[d.environment,d.chainId,d.deploymentDigest,number.toString(),blockHash]);
}

test('display event inbox reads canonical hints and recovery catches missing range logs',{timeout:120_000},async context=>{
 const schemaName=`tg_event_inbox_${process.pid}_${randomBytes(4).toString('hex')}`,schema=schemaIdent(schemaName);
 const pool=createDatabasePool(databaseUrl,{max:1,connectionTimeoutMillis:5_000}).pool;
 try{
  try{await applyCoreMigration(pool,schemaName);}catch(error){if(process.env.TG_TEST_DISPLAY_DATABASE_URL||!['ECONNREFUSED','ENOENT','28P01','28000'].includes(String((error as {code?:string}).code)))throw error;context.skip('Local PostgreSQL unavailable for display event inbox integration test');return;}
  const client=await pool.connect();
  try{
   const readDeployment=deployment(1),readLog=log(4n,h('4'),0n),created=marketCreatedLog('1',4n,h('4'),1n),canonical=new Map([[4n,h('4')],[5n,h('5')],[6n,h('6')],[7n,h('7')],[8n,h('8')],[10n,h('a')]]);
   await insertInbox(client,schema,readDeployment,[readLog,readLog,created]);
   const unique=(await client.query(`SELECT count(*)::int AS n FROM ${schema}.display_event_inbox WHERE deployment_digest=$1 AND log_index=0`,[readDeployment.deploymentDigest])).rows[0];
   assert.equal(unique.n,1,'duplicate unique inbox notifications are idempotent');
   let getLogs=0;
   const readResult=await readDisplayEvents(client,readDeployment,rpc(canonical,[],()=>getLogs++),4n,4n,schemaName);
   assert.deepEqual(readResult?.logs.map(l=>l.logIndex),[0n,1n]);
   const createdToken=a('3');
   assert.equal(readResult?.modules.get(createdToken),'TickerMemeTokenV1','a real MarketCreated inbox event discovers its meme token module');
   assert.equal(readResult?.modules.get(a('4')),'TickerGardenCurve','a real MarketCreated inbox event discovers its curve module');
   assert.equal(readResult?.modules.get(a('5')),'MemeStockGauge','a real MarketCreated inbox event discovers its gauge module');
   assert.equal(getLogs,0,'inbox reads validate block hashes without requesting eth_getLogs');

   const forkDeployment=deployment(2),forkLog=marketCreatedLog('8',4n,h('d'),1n);
   await insertInbox(client,schema,forkDeployment,[forkLog]);
   const forkResult=await readDisplayEvents(client,forkDeployment,rpc(canonical),4n,4n,schemaName);
   assert.deepEqual(forkResult?.logs,[],'events from a stale fork are skipped');
   assert.equal(forkResult?.creations.size,0,'a MarketCreated event from an unrelated prior fork cannot discover a market');

   const removedDeployment=deployment(7),removedCreation=marketCreatedLog('9',4n,h('4'),2n);
   await insertInbox(client,schema,removedDeployment,[removedCreation],true);
   const removedResult=await readDisplayEvents(client,removedDeployment,rpc(canonical),4n,4n,schemaName);
   assert.deepEqual(removedResult?.logs,[],'removed notifications are never active events');
   assert.equal(removedResult?.creations.size,0,'a removed MarketCreated notification cannot create an active market');

   const saturatedDeployment=deployment(3),many=Array.from({length:1000},(_,i)=>log(5n,h('5'),BigInt(i)));
   await insertInbox(client,schema,saturatedDeployment,many);
   const saturated=await readDisplayEvents(client,saturatedDeployment,rpc(canonical),5n,5n,schemaName);
   assert.equal(saturated,null,'a full 1000-row batch forces bounded range recovery');

   const lateDeployment=deployment(4),late=log(7n,h('7'),2n);
   await setCoverage(client,schema,lateDeployment,5n,h('5'));
   await initializeEventCoverage(client,lateDeployment,{block_number:'5',block_hash:h('5')},schemaName);
   await insertInbox(client,schema,lateDeployment,[late]);
   const latePlan=await planDisplayEvents(client,lateDeployment,rpc(canonical),{block_number:'10',block_hash:h('a')},false,schemaName);
   assert.deepEqual(latePlan,{scan:true,replayFrom:6n},'a late unseen canonical event replays from just after verified coverage');

   const duplicateDeployment=deployment(5),alreadyApplied=log(7n,h('7'),3n);
   await setCoverage(client,schema,duplicateDeployment,5n,h('5'));
   await initializeEventCoverage(client,duplicateDeployment,{block_number:'5',block_hash:h('5')},schemaName);
   await insertInbox(client,schema,duplicateDeployment,[alreadyApplied]);
   await saveAppliedEvents(client,duplicateDeployment,[alreadyApplied],schemaName);
   const duplicatePlan=await planDisplayEvents(client,duplicateDeployment,rpc(canonical),{block_number:'10',block_hash:h('a')},false,schemaName);
   assert.deepEqual(duplicatePlan,{scan:false},'an already applied event does not trigger replay');
   await assert.rejects(()=>commitEventCoverage(client,duplicateDeployment,7n,h('7'),false,schemaName,7n),/skip an unverified gap/);

   const gapDeployment=deployment(6),source=fixedF72Sources().find(item=>item.module!=='TickerGardenFactoryV1'&&item.module!=='UniswapV4PoolManager')!;
   const topic=eventTopicsForModules([source.module])[0];
   const unseen={...log(6n,h('6'),4n),address:source.address,topics:[topic] as [`0x${string}`]};
   await setCoverage(client,schema,gapDeployment,5n,h('5'));
   await initializeEventCoverage(client,gapDeployment,{block_number:'5',block_hash:h('5')},schemaName);
   const recoveryRpc={...rpc(canonical,[unseen],()=>getLogs++),logs:async()=>[],call:async(method:string)=>{if(method==='eth_getLogs'){getLogs++;return [
    {address:unseen.address,blockHash:unseen.blockHash,blockNumber:'0x6',transactionHash:unseen.transactionHash,transactionIndex:'0x0',logIndex:'0x4',data:'0x',topics:unseen.topics,removed:false},
   ];}throw Error(`unexpected RPC method ${method}`);}} as unknown as RpcTransport;
   const before=getLogs;
   const gapPlan=await planDisplayEvents(client,gapDeployment,recoveryRpc,{block_number:'6',block_hash:h('6')},true,schemaName);
   assert.deepEqual(gapPlan,{scan:true,replayFrom:6n},'due range recovery detects a canonical log missing from the inbox');
   assert.ok(getLogs>before,'due recovery performs an authoritative eth_getLogs scan');
  }finally{client.release();}
 }finally{await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`).catch(()=>undefined);await pool.end();}
});
