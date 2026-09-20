import assert from 'node:assert/strict';import test from 'node:test';import {randomBytes} from 'node:crypto';
import {applyCoreMigration,createDatabasePool} from '../../packages/db/src/index.ts';
import {RpcTransport,type RpcTransportOptions} from '../../packages/chain/src/index.ts';
import {RpcControlStore,digest} from '../../packages/rpc-control/src/store.ts';
const h=`0x${'1'.repeat(64)}`,h2=`0x${'2'.repeat(64)}`,a=`0x${'a'.repeat(40)}`,b=`0x${'b'.repeat(40)}`,topic=`0x${'3'.repeat(64)}`;
test('separate transports reuse complete scans and receipts; changed anchors force fresh scans',{timeout:20000},async()=>{
 const schema=`tg_rpc_shared_${process.pid}_${randomBytes(3).toString('hex')}`,pool=createDatabasePool('postgresql:///postgres?host=/tmp',{max:4}).pool;
 try{
  await applyCoreMigration(pool,schema);const store=new RpcControlStore(()=>pool,schema),counts=new Map<string,number>();let current=h;
  const log=(address:string,index:number)=>({address,blockHash:current,blockNumber:'0x5',transactionHash:h,transactionIndex:'0x0',logIndex:`0x${index}`,data:'0x',topics:[topic],removed:false});
  const shared:NonNullable<RpcTransportOptions['sharedReads']>={get:(e,k)=>store.get(digest(e),k),put:(e,k,v,ttl)=>store.put(digest(e),k,v,ttl),share:(e,k,run,ttl)=>store.share(digest(e),k,run,ttl),findScan:(e,f)=>store.findScan(digest(e),f),saveScan:(e,f,hash,v)=>store.saveScan(digest(e),f,hash,v)};
  const make=()=>new RpcTransport({url:'https://rpc.example',sharedReads:shared,fetch:async(_url,init)=>{
   const r=JSON.parse(String(init?.body));counts.set(r.method,(counts.get(r.method)??0)+1);
   const result=r.method==='eth_getBlockByNumber'?{number:r.params[0],hash:current,parentHash:h2,timestamp:'0x64'}:r.method==='eth_getLogs'?[log(a,0),log(b,1)].filter(l=>r.params[0].address.includes(l.address)):r.method==='eth_getTransactionReceipt'?{transactionHash:h,blockHash:current,blockNumber:'0x5',status:'0x1',logs:[log(a,0)]}:'0x1234';
   return Response.json({jsonrpc:'2.0',id:r.id,result});
  }});
  const display=make(),settlement=make();
  await display.logs({fromBlock:1n,toBlock:10n,addresses:[a,b],topics:[[topic,h2]]});
  const subset=await settlement.logs({fromBlock:3n,toBlock:8n,addresses:[a],topics:[topic]});
  assert.equal(subset.length,1);assert.equal(counts.get('eth_getLogs'),1,'finalized consumer reuses a complete, anchored superset');
  current=h2;await settlement.logs({fromBlock:3n,toBlock:8n,addresses:[a],topics:[topic]});assert.equal(counts.get('eth_getLogs'),2,'reorg cannot reuse old coverage');
  await Promise.all([display.call('eth_getTransactionReceipt',[h]),settlement.call('eth_getTransactionReceipt',[h])]);assert.equal(counts.get('eth_getTransactionReceipt'),1,'cross-instance same-hash receipt check coalesces');
  await display.atBlock(10n,h2,()=>display.callAt(a as `0x${string}`,'0x1234',10n));
  await settlement.atBlock(10n,h2,()=>settlement.callAt(a as `0x${string}`,'0x1234',10n));assert.equal(counts.get('eth_call'),1,'verified immutable reads reused across contexts');
 }finally{await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);await pool.end();}
});
