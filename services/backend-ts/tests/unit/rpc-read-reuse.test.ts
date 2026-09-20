import assert from 'node:assert/strict';
import test from 'node:test';
import {RpcTransport,type RpcTransportOptions} from '../../packages/chain/src/index.ts';
import {coversTopics,scanFilter,filterScan} from '../../packages/rpc-control/src/scan.ts';
const hash=`0x${'1'.repeat(64)}`,other=`0x${'2'.repeat(64)}`,address=`0x${'a'.repeat(40)}` as const;
function fixture(){
 const calls:string[]=[],cache=new Map<string,unknown>();let current=hash,puts=0;
 const shared:NonNullable<RpcTransportOptions['sharedReads']>={get:async(e,k)=>cache.get(e+k),put:async(e,k,v)=>{puts++;cache.set(e+k,v);},share:async(_e,_k,run)=>({value:await run(),reused:false}),findScan:async()=>undefined,saveScan:async()=>{}};
 const fetcher:typeof fetch=async(_url,init)=>{const b=JSON.parse(String(init?.body));calls.push(b.method);return Response.json({jsonrpc:'2.0',id:b.id,result:b.method==='eth_getBlockByNumber'?{number:b.params[0]==='latest'?'0xa':b.params[0],hash:current,parentHash:other,timestamp:'0x64'}:b.method==='eth_getTransactionReceipt'?null:'0x1234'});};
 const rpc=new RpcTransport({url:'https://rpc.example',fetch:fetcher,sharedReads:shared});
 return {rpc,calls,cache,get puts(){return puts;},reorg(){current=other;}};
}
test('fixed hash context shares completed reads; canonical checks and latest remain fresh',async()=>{
 const f=fixture();await f.rpc.atBlock(10n,hash,async()=>{
  assert.equal(await f.rpc.callAt(address,'0x1234',10n),'0x1234');await f.rpc.callAt(address,'0x1234',10n);
  await f.rpc.latestBlock();await f.rpc.latestBlock();
 });
 assert.equal(f.calls.filter(m=>m==='eth_call').length,1);assert.equal(f.calls.filter(m=>m==='eth_getBlockByNumber').length,4);assert.equal(f.puts,1);
 await f.rpc.atBlock(10n,hash,()=>f.rpc.callAt(address,'0x1234',10n));assert.equal(f.calls.filter(m=>m==='eth_call').length,1);
 await f.rpc.atBlock(10n,hash,()=>f.rpc.callAt(address,'0x9999',10n));assert.equal(f.calls.filter(m=>m==='eth_call').length,2);
});
test('reorg fails the operation and never publishes unverified hash-bound cache entries',async()=>{
 const f=fixture();await assert.rejects(f.rpc.atBlock(10n,hash,async()=>{await f.rpc.callAt(address,'0x1234',10n);f.reorg();}),/block changed/);
 assert.equal(f.puts,0);assert.equal(f.cache.size,0);
 await assert.rejects(f.rpc.atBlock(10n,hash,()=>f.rpc.callAt(address,'0x1234',10n)),/block changed/);
});
test('latest reads, pending nonce and missing receipt are never completed-cache hits',async()=>{
 const f=fixture();for(let i=0;i<2;i++){await f.rpc.call('eth_call',[{to:address,data:'0x1234'},'latest']);await f.rpc.call('eth_getTransactionCount',[address,'pending']);await f.rpc.call('eth_getTransactionReceipt',[hash]);}
 assert.equal(f.calls.length,6);assert.equal(f.puts,0);
});
test('complete scan reuse requires a superset at every topic position including pool ID',()=>{
 assert.ok(coversTopics([[hash,other]],[hash]));assert.ok(!coversTopics([hash],[[hash,other]]));
 assert.ok(!coversTopics([hash,hash],[hash,other]));assert.ok(!coversTopics([hash,hash],[hash,null]));
 const f=scanFilter('eth_getLogs',[{fromBlock:'0x1',toBlock:'0xa',address:[address],topics:[hash,hash]}])!;
 assert.equal(filterScan([{address,blockNumber:'0x3',topics:[hash,hash]},{address,blockNumber:'0x3',topics:[hash,other]}],f).length,1);
 assert.equal(scanFilter('eth_getLogs',[{fromBlock:'latest',toBlock:'latest',address,topics:[hash]}]),undefined);
});
