import assert from 'node:assert/strict';
import test from 'node:test';
import {randomBytes} from 'node:crypto';
import {encodeAbiParameters,parseAbiParameters} from 'viem';
import {applyCoreMigration,createDatabasePool} from '../../packages/db/src/index.ts';
import {advanceConfirmedDisplay} from '../../packages/confirmed-display/src/worker.ts';
import {fixedF72Sources,eventTopic} from '../../packages/events/src/index.ts';
import {parseLog,type RpcTransport} from '../../packages/chain/src/index.ts';
const h=(n:number)=>`0x${n.toString(16).padStart(64,'0')}` as `0x${string}`,a=(n:number)=>`0x${n.toString(16).padStart(40,'0')}` as `0x${string}`;
const registry=fixedF72Sources().find(s=>s.module==='MarketRegistryV1')!;
function log(n:number,tx:number,index:number,hash=h(n)){
 return {address:registry.address,blockNumber:`0x${n.toString(16)}`,blockHash:hash,transactionHash:h(tx),transactionIndex:'0x0',logIndex:`0x${index.toString(16)}`,removed:false,
 topics:[eventTopic('MarketRegistryV1','MarketRegistered'),h(900+tx),h(2),h(3)],data:encodeAbiParameters(parseAbiParameters('address,address,uint32'),[a(4),a(5),1])};
}
test('WS display expands receipts without scanning, deduplicates, repairs late/missed events and rewinds reorgs',{timeout:60000},async()=>{
 const schemaName=`tg_push_${process.pid}_${randomBytes(4).toString('hex')}`,s=`"${schemaName}"`,pool=createDatabasePool('postgresql:///postgres?host=/tmp',{max:2}).pool;
 const deployment={environment:'test' as const,chainId:46630 as const,deploymentDigest:h(1000),activationBlock:10n},id=[deployment.environment,deployment.chainId,deployment.deploymentDigest];
 let head=12,finalTip=10,failReceipt=false,reorg=false,logCalls=0,receiptCalls=0,logs=[log(12,100,0),log(12,100,1)];
 const block=(number:bigint)=>({number,hash:reorg&&number===14n?h(1400):h(Number(number)),parentHash:h(Number(number)-1),timestamp:1800000000n+number});
 const select=(filter:any)=>logs.filter(l=>BigInt(l.blockNumber)>=BigInt(filter.fromBlock)&&BigInt(l.blockNumber)<=BigInt(filter.toBlock)&&(filter.address??filter.addresses).includes(l.address));
 const rpc={chainId:async()=>46630n,finalizedBlock:async()=>block(BigInt(finalTip)),latestBlock:async()=>block(BigInt(head)),block:async(n:bigint)=>block(n),logs:async(filter:any)=>{logCalls++;return select(filter).map(parseLog);},call:async(method:string,[filter]:any[])=>{
  if(method==='eth_getLogs'){logCalls++;return select(filter);}
  if(method==='eth_getTransactionReceipt'){receiptCalls++;const matches=logs.filter(l=>l.transactionHash===filter);assert.ok(matches.length);return {status:failReceipt?'0x0':'0x1',transactionHash:filter,blockHash:matches[0]!.blockHash,blockNumber:matches[0]!.blockNumber,logs:matches};}
  throw Error(method);
 }} as unknown as RpcTransport;
 const insert=async(l:ReturnType<typeof log>)=>pool.query(`INSERT INTO ${s}.display_event_inbox(environment,chain_id,deployment_digest,block_number,block_hash,transaction_hash,log_index,removed,payload) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT DO NOTHING`,[...id,String(BigInt(l.blockNumber)),l.blockHash,l.transactionHash,String(BigInt(l.logIndex)),l.removed,JSON.stringify(l)]);
 const run=(forceRecovery=false)=>advanceConfirmedDisplay({pool,deployment,rpc,schemaName,eventDriven:true,forceRecovery});
 const applied=async()=>(await pool.query(`SELECT count(*)::int n FROM ${s}.display_event_applied`)).rows[0].n;
 try{
  await applyCoreMigration(pool,schemaName);
  await pool.query(`INSERT INTO ${s}.deployments(environment,chain_id,deployment_digest,genesis_hash,start_block,start_block_hash,abi_digest) VALUES($1,$2,$3,$4,10,$5,$6)`,[...id,h(2),h(10),h(3)]);
  await pool.query(`INSERT INTO ${s}.chain_blocks(environment,chain_id,deployment_digest,number,hash,parent_hash,canonical,finalized,source_timestamp) VALUES($1,$2,$3,10,$4,$5,true,true,to_timestamp(1800000010))`,[...id,h(10),h(9)]);
  await pool.query(`INSERT INTO ${s}.projection_checkpoints(environment,chain_id,deployment_digest,scope,algorithm_version,next_block,generation,last_revision) VALUES($1,$2,$3,'analytics','fixture',11,1,$4)`,[...id,`10:${h(10)}`]);
  // One notification contains enough information to verify all logs of its transaction.
  await insert(logs[0]!);failReceipt=true;await assert.rejects(run(),/Confirmed receipt unavailable/);assert.equal(await applied(),0);failReceipt=false;receiptCalls=0;assert.equal(await run(),'confirmed:12:0');assert.equal(logCalls,0);assert.equal(receiptCalls,1);assert.equal(await applied(),2);
  assert.equal((await pool.query(`SELECT block_number::text FROM ${s}.display_event_coverage`)).rows[0].block_number,'10');
  await insert(logs[1]!);await insert(logs[0]!);assert.equal(await run(),'current');assert.equal(receiptCalls,1);assert.equal(logCalls,0);
  // A later notification from an older block must replay in chain order, not append.
  head=13;logs.push(log(11,101,0));await insert(logs[2]!);assert.equal(await run(),'confirmed:13:0');assert.equal(await applied(),3);assert.equal(receiptCalls,3);assert.equal(logCalls,2);
  // Advance speculatively, deliberately omit an earlier transaction's WS notification.
  head=15;finalTip=15;logs.push(log(15,103,0));await insert(logs[3]!);assert.equal(await run(),'confirmed:15:0');assert.equal(logCalls,2);assert.equal((await pool.query(`SELECT count(*)::int n FROM ${s}.confirmed_display_journal WHERE block_number=15`)).rows[0].n,1,'uncovered speculative journal survives finalized');
  finalTip=13;logs.push(log(14,102,0));assert.equal(await run(true),'confirmed:15:0');assert.equal(await applied(),2);
  assert.equal((await pool.query(`SELECT block_number::text FROM ${s}.display_event_coverage`)).rows[0].block_number,'15');
  // A shorter head must enter journal rollback before trying range recovery above head.
  reorg=true;head=14;logs=[log(14,104,0,h(1400))];assert.equal(await run(),'confirmed:14:0');assert.equal(await applied(),1);
  assert.equal((await pool.query(`SELECT block_hash FROM ${s}.confirmed_display_cursor`)).rows[0].block_hash,h(1400));
  assert.equal((await pool.query(`SELECT next_block::text FROM ${s}.projection_checkpoints WHERE scope='analytics'`)).rows[0].next_block,'11');
 }finally{await pool.query(`DROP SCHEMA IF EXISTS ${s} CASCADE`);await pool.end();}
});
