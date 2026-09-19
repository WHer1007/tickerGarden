import test from 'node:test';import assert from 'node:assert/strict';
import {inspectPendingNetwork} from '../src/v1/pendingNetwork.ts';
const account='0x1111111111111111111111111111111111111111',hash=`0x${'a'.repeat(64)}` as const;
const rpc=(tx:unknown=null,count='0xa',chain='0x1237')=>async(method:string)=>method==='eth_chainId'?chain:method==='eth_getTransactionByHash'?tx:count;
test('missing hash alone never means failed or nonce consumed',async()=>{
 assert.equal((await inspectPendingNetwork(account,hash,undefined,4663,[rpc(),rpc()])).state,'unobserved');
 assert.equal((await inspectPendingNetwork(account,hash,10,4663,[rpc(),rpc()])).state,'unobserved');
});
test('both sources must establish finalized nonce consumption',async()=>{
 assert.equal((await inspectPendingNetwork(account,hash,9,4663,[rpc(),rpc()])).state,'nonce_consumed');
 assert.equal((await inspectPendingNetwork(account,hash,9,4663,[rpc(),rpc(null,'0x9')])).state,'unobserved');
});
test('wallet source discovers missing transaction nonce',async()=>{
 assert.deepEqual(await inspectPendingNetwork(account,hash,undefined,4663,[rpc(),rpc({hash,from:account,nonce:'0x9'})]),{state:'pending',nonce:9});
});
test('wrong chain, unrelated hash and RPC errors never unlock',async()=>{
 for(const other of [rpc(null,'0xff','0x1'),rpc({hash:'wrong',from:account,nonce:'0x9'}),async()=>{throw Error('offline');}]){
 assert.equal((await inspectPendingNetwork(account,hash,9,4663,[rpc(),other])).state,'unavailable');
 }
});
test('transaction visible on either source remains pending',async()=>{
 assert.equal((await inspectPendingNetwork(account,hash,9,4663,[rpc({hash,from:account,nonce:'0x9'}),rpc(null,'0xff')])).state,'pending');
});
