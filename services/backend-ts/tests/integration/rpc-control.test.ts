import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import test from 'node:test';
import {applyCoreMigration,createDatabasePool} from '../../packages/db/src/index.ts';
import {RpcBudgetBusy,RpcControlStore} from '../../packages/rpc-control/src/store.ts';
import {rpcBudgetEndpoint} from '../../apps/read-api/src/rpc-budget.ts';

const databaseUrl='postgresql:///postgres?host=/tmp';
const schemaName=`tg_rpc_control_${process.pid}_${randomBytes(4).toString('hex')}`;
const schema=`"${schemaName}"`;

test('RPC control budgets, shared reads, scan cache and pruning use shared PostgreSQL state',{timeout:30_000},async context=>{
 const pool=createDatabasePool(databaseUrl,{max:6,connectionTimeoutMillis:5_000}).pool;
 try{
  try{await applyCoreMigration(pool,schemaName);}catch(error){if(['ECONNREFUSED','ENOENT','28P01','28000'].includes(String((error as {code?:string}).code))){context.skip('Local PostgreSQL at /tmp is unavailable for RPC control integration tests');return;}throw error;}
  const first=new RpcControlStore(()=>pool,schemaName),second=new RpcControlStore(()=>pool,schemaName);

  const limited=await Promise.allSettled([
   first.acquire('budget:single','realtime',{rps:0,burst:1,interactiveReserve:0,backgroundConcurrency:10,nonInteractiveConcurrency:10}),
   second.acquire('budget:single','realtime',{rps:0,burst:1,interactiveReserve:0,backgroundConcurrency:10,nonInteractiveConcurrency:10}),
  ]);
  const acquired=limited.filter((result):result is PromiseFulfilledResult<Awaited<ReturnType<typeof first.acquire>>>=>result.status==='fulfilled').map(result=>result.value);
  assert.equal(acquired.length,1,'two store instances cannot spend more tokens than the shared burst budget');
  assert.ok(limited.some(result=>result.status==='rejected'&&result.reason instanceof RpcBudgetBusy));
  await Promise.all(acquired.map(lease=>lease.release()));

  const reserveBudget={rps:0,burst:2,interactiveReserve:1,backgroundConcurrency:10,nonInteractiveConcurrency:10};
  const reserved=await Promise.allSettled([
   first.acquire('budget:reserve','realtime',reserveBudget),
   second.acquire('budget:reserve','realtime',reserveBudget),
  ]);
  const reservedLeases=reserved.filter((result):result is PromiseFulfilledResult<Awaited<ReturnType<typeof first.acquire>>>=>result.status==='fulfilled').map(result=>result.value);
  assert.equal(reservedLeases.length,1,'non-interactive work leaves the configured interactive token reserve');
  assert.ok(reserved.some(result=>result.status==='rejected'&&result.reason instanceof RpcBudgetBusy));
  const interactive=await second.acquire('budget:reserve','interactive',reserveBudget);
  await Promise.all([...reservedLeases.map(lease=>lease.release()),interactive.release()]);

  const concurrencyBudget={rps:0,burst:20,interactiveReserve:0,backgroundConcurrency:1,nonInteractiveConcurrency:10};
  const background=await first.acquire('lease:background','background',concurrencyBudget);
  await assert.rejects(second.acquire('lease:background','background',concurrencyBudget),RpcBudgetBusy);
  await background.release();
  const afterRelease=await second.acquire('lease:background','background',concurrencyBudget);
  await afterRelease.release();

  const policyBudget={rps:1,burst:3,interactiveReserve:1,backgroundConcurrency:1,nonInteractiveConcurrency:2};
  const policyLease=await first.acquire('budget:policy','realtime',policyBudget);
  await policyLease.release();
  await assert.rejects(second.acquire('budget:policy','realtime',{...policyBudget,burst:4}),/RPC budget policy mismatch/);

  let sharedRuns=0;
  const shared=await Promise.all([
   first.share('reads','same-key',async()=>{sharedRuns++;await new Promise(resolve=>setTimeout(resolve,160));return {answer:42};},10_000),
   second.share('reads','same-key',async()=>{sharedRuns++;return {answer:42};},10_000),
  ]);
  assert.equal(sharedRuns,1,'concurrent same-key reads across stores execute once');
  assert.deepEqual(shared.map(result=>result.value),[{answer:42},{answer:42}]);
  assert.equal(shared.filter(result=>result.reused).length,1);

  await assert.rejects(first.share('reads','failed',async()=>{throw new Error('upstream failed');},10_000),/upstream failed/);
  assert.equal(await second.get('reads','failed'),undefined,'failed reads leave no cache entry');
  assert.deepEqual((await second.share('reads','failed',async()=>({ok:true}),10_000)).value,{ok:true});

  let nullRuns=0;
  for(let i=0;i<2;i++){
   const result=await (i===0?first:second).share<null>('reads','null-result',async()=>{nullRuns++;return null;},10_000);
   assert.equal(result.value,null);
  }
  assert.equal(nullRuns,2,'null results are not cached');
  assert.equal(await first.get('reads','null-result'),undefined);

  const addressA=`0x${'1'.repeat(40)}`,addressB=`0x${'2'.repeat(40)}`;
  const topicA=`0x${'a'.repeat(64)}`,topicB=`0x${'b'.repeat(64)}`,topicOther=`0x${'c'.repeat(64)}`;
  const broadFilter={from:10n,to:20n,addresses:[addressA,addressB],topics:[[topicA,topicB],null]};
  const payload=[{address:addressA,blockNumber:'0xf',topics:[topicA]}];
  await first.saveScan('chain:4663:pool-a',broadFilter,'block-hash-a',payload);
  const subset=await second.findScan('chain:4663:pool-a',{from:12n,to:18n,addresses:[addressA],topics:[topicA]});
  assert.deepEqual(subset?.payload,payload,'a wider topic scan can satisfy a narrower topic request');
  assert.equal(await second.findScan('chain:4663:pool-a',{from:12n,to:18n,addresses:[addressA],topics:[topicOther]}),undefined,'uncovered topics do not match');
  assert.equal(await second.findScan('chain:4663:pool-b',{from:12n,to:18n,addresses:[addressA],topics:[topicA]}),undefined,'scan entries are scoped by pool identity');

  const shardFilterA={from:30n,to:40n,addresses:[addressA],topics:[topicA]};
  const shardFilterB={from:30n,to:40n,addresses:[addressB],topics:[topicA]};
  const shardLogA={address:addressA,blockHash:'anchor-1',blockNumber:'0x28',transactionHash:'tx-a',logIndex:'0x0',topics:[topicA]};
  const shardLogB={address:addressB,blockHash:'anchor-1',blockNumber:'0x28',transactionHash:'tx-b',logIndex:'0x1',topics:[topicA]};
  await first.saveScan('chain:4663:pool-shards',{...shardFilterA,to:40n},'anchor-1',[shardLogA]);
  await second.saveScan('chain:4663:pool-shards',shardFilterB,'anchor-1',[shardLogB]);
  const merged=await first.findScan('chain:4663:pool-shards',{from:32n,to:40n,addresses:[addressA,addressB],topics:[topicA]});
  assert.deepEqual(merged?.payload,[shardLogA,shardLogB],'address shards merge when their end block and hash anchor match');
  await first.saveScan('chain:4663:pool-mixed-hash',shardFilterA,'anchor-1',[shardLogA]);
  await second.saveScan('chain:4663:pool-mixed-hash',shardFilterB,'anchor-2',[{...shardLogB,blockHash:'anchor-2'}]);
  assert.equal(await first.findScan('chain:4663:pool-mixed-hash',{from:32n,to:40n,addresses:[addressA,addressB],topics:[topicA]}),undefined,'address shards with different ending block hashes cannot be combined');

  const endpointBudget={rps:1,burst:2,interactiveReserve:1,backgroundConcurrency:1,nonInteractiveConcurrency:2};
  const endpointEnv={TG_RPC_CONTROL_ENABLED:'true',TG_RPC_BUDGETS_JSON:JSON.stringify({other:endpointBudget}),TG_RPC_BUDGET_TOKEN:'local-rpc-budget-test-token-with-32-plus-chars',TG_CHAIN_ID:'46630',TG_ENVIRONMENT:'test',TG_DATABASE_SCHEMA:schemaName};
  const endpointA=rpcBudgetEndpoint(()=>pool,endpointEnv),endpointB=rpcBudgetEndpoint(()=>pool,endpointEnv);
  const request=(body:unknown,authorized=true)=>new Request('http://localhost/v1/internal/rpc-budget',{method:'POST',headers:{'content-type':'application/json',...(authorized?{authorization:`Bearer ${endpointEnv.TG_RPC_BUDGET_TOKEN}`}:{})},body:JSON.stringify(body)});
  assert.equal((await endpointA(request({action:'acquire',provider:'other',tier:'realtime'},false)).then(response=>response.status)),403,'budget endpoint rejects unauthorized requests');
  assert.equal((await endpointA(request({action:'acquire'})).then(response=>response.status)),400,'budget endpoint rejects malformed request shapes');
  const acquiredResponse=await endpointA(request({action:'acquire',provider:'other',tier:'realtime'}));
  assert.equal(acquiredResponse.status,200);
  const acquiredBody=await acquiredResponse.json() as {id:string};
  assert.match(acquiredBody.id,/^[0-9a-f-]{36}$/);
  assert.equal((await endpointB(request({action:'acquire',provider:'other',tier:'realtime'})).then(response=>response.status)),429,'a second endpoint instance observes shared budget depletion');
  const releasedResponse=await endpointA(request({action:'release',id:acquiredBody.id}));
  assert.equal(releasedResponse.status,200);
  assert.deepEqual(await releasedResponse.json(),{ok:true});

  const expired=new Date(Date.now()-60_000).toISOString();
  await pool.query(`INSERT INTO ${schema}.rpc_leases(id,scope,tier,expires_at) VALUES($1,'expired','background',$2)`,[randomUUID(),expired]);
  await pool.query(`INSERT INTO ${schema}.rpc_read_locks(scope,key,owner,expires_at) VALUES('expired','key',gen_random_uuid(),$1)`,[expired]);
  await pool.query(`INSERT INTO ${schema}.rpc_read_cache(scope,key,payload,expires_at) VALUES('expired','key','{}',$1)`,[expired]);
  await pool.query(`INSERT INTO ${schema}.rpc_scan_cache(scope,key,from_block,to_block,block_hash,addresses,topics,payload,expires_at) VALUES('expired','key',1,1,'hash',$1,'[]','[]',$2)`,[[addressA],expired]);
  await first.prune();
  for(const table of ['rpc_leases','rpc_read_locks','rpc_read_cache','rpc_scan_cache']){
   const count=(await pool.query<{count:number}>(`SELECT count(*)::int count FROM ${schema}.${table} WHERE expires_at<$1`,[new Date().toISOString()])).rows[0]!.count;
   assert.equal(count,0,`prune removes expired ${table} rows`);
  }
 }finally{
  await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`).catch(()=>undefined);
  await pool.end();
 }
});
