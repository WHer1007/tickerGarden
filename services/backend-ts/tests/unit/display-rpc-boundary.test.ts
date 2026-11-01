import test from 'node:test';
import assert from 'node:assert/strict';
import {displayRpcFetch,withDisplayTrigger} from '../../packages/confirmed-display/src/rpc-boundary.ts';
import {advanceConfirmedDisplay} from '../../packages/confirmed-display/src/worker.ts';
test('startup, idle and price-only contexts cannot send RPC; triggered range scans are also denied',async()=>{
 let calls=0;const fetcher=displayRpcFetch(async()=>{calls++;return new Response('{}');});
 const send=(method:string)=>fetcher('https://rpc.example',{method:'POST',body:JSON.stringify({method})});
 await assert.rejects(send('eth_chainId'),/requires/);
 await withDisplayTrigger({kind:'event',id:'tx'},async()=>{
  await assert.rejects(send('eth_getLogs'),/forbidden/);
  await assert.rejects(send('eth_getBlockReceipts'),/forbidden/);
  await send('eth_getTransactionReceipt');
 });
 await assert.rejects(send('eth_blockNumber'),/requires/);assert.equal(calls,1);
});
test('an untriggered display pass does not even touch its database or RPC',async()=>{
 const bomb=new Proxy({}, {get(){throw Error('unexpected IO');}});
 assert.equal(await advanceConfirmedDisplay({pool:bomb,rpc:bomb,deployment:bomb} as any),'idle');
});
