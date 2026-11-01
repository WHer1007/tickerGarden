import test from 'node:test';
import assert from 'node:assert/strict';
import {displayRpcFetch,withDisplayTrigger,bindDisplayEvent,DISPLAY_RPC_LIMIT} from '../../packages/confirmed-display/src/rpc-boundary.ts';
import {advanceConfirmedDisplay} from '../../packages/confirmed-display/src/worker.ts';
const tx=`0x${'a'.repeat(64)}`,hash=`0x${'b'.repeat(64)}`;
test('display allows only the concrete transaction and fixed event block; no head, range or unrelated reads',async()=>{
 let calls=0;const fetcher=displayRpcFetch(async()=>{calls++;return new Response('{}');});
 const send=(method:string,params:unknown[]=[])=>fetcher('https://rpc.example',{method:'POST',body:JSON.stringify({method,params})});
 await assert.rejects(send('eth_chainId'),/requires/);
 await withDisplayTrigger({kind:'event',id:tx},async()=>{
  await assert.rejects(send('eth_chainId'),/requires/);
  bindDisplayEvent({transactionHash:tx,blockNumber:42n,blockHash:hash});
  for(const [method,params] of [['eth_getLogs',[]],['eth_getBlockReceipts',['0x2a']],['eth_blockNumber',[]],['eth_getBlockByNumber',['latest',false]],['eth_getBlockByNumber',['finalized',false]],['eth_getBlockByNumber',['0x29',false]],['eth_getTransactionReceipt',[hash]],['eth_call',[{},'latest']],['eth_getCode',['0x123','0x29']]] as [string,unknown[]][]){await assert.rejects(send(method,params),/forbidden/);}
  await send('eth_getTransactionReceipt',[tx]);await send('eth_getBlockByNumber',['0x2a',false]);await send('eth_call',[{to:'0x123'},{blockHash:hash,requireCanonical:true}]);
  assert.throws(()=>bindDisplayEvent({transactionHash:hash,blockNumber:43n,blockHash:hash}),/rebound/);
 });
 assert.equal(calls,3);
});
test('physical attempts are bounded even when upstream requests fail',async()=>{
 let calls=0;const send=displayRpcFetch(async()=>{calls++;throw Error('upstream');});
 await withDisplayTrigger({kind:'request',id:'receipt',transactionHash:tx},async()=>{
  bindDisplayEvent({transactionHash:tx,blockNumber:42n,blockHash:hash});
  for(let i=0;i<DISPLAY_RPC_LIMIT;i++)await assert.rejects(send('https://rpc.example',{body:JSON.stringify({method:'eth_getTransactionReceipt',params:[tx]})}),/upstream/);
  await assert.rejects(send('https://rpc.example',{body:JSON.stringify({method:'eth_getTransactionReceipt',params:[tx]})}),/budget exceeded/);
 });assert.equal(calls,DISPLAY_RPC_LIMIT);
});
test('an untriggered display pass does not touch its database or RPC',async()=>{
 const bomb=new Proxy({}, {get(){throw Error('unexpected IO');}});
 assert.equal(await advanceConfirmedDisplay({pool:bomb,rpc:bomb,deployment:bomb} as any),'idle');
});
