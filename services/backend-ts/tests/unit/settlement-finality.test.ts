import test from 'node:test';
import assert from 'node:assert/strict';
import {settlementFinalizedUpper} from '../../packages/chain-worker/src/index.ts';
import type {RpcTransport,RpcBlock} from '../../packages/chain/src/index.ts';
const block=(number:bigint,hash=`0x${'a'.repeat(64)}`):RpcBlock=>({number,hash:hash as `0x${string}`,parentHash:`0x${'b'.repeat(64)}`,timestamp:number});
const rpc=(number:bigint)=>({finalizedBlock:async()=>block(number),block:async(n:bigint)=>block(n)}) as RpcTransport;
test('settlement uses the lower canonical finalized anchor, not elapsed time',async()=>assert.equal(await settlementFinalizedUpper(rpc(90n),rpc(88n),block(100n)),88n));
test('settlement rejects a forged tag or anchor ahead of head',async()=>{
 await assert.rejects(settlementFinalizedUpper(rpc(101n),rpc(101n),block(100n)));
 const altered={...rpc(90n),finalizedBlock:async()=>block(90n,`0x${'c'.repeat(64)}`)} as unknown as RpcTransport;
 await assert.rejects(settlementFinalizedUpper(altered,rpc(90n),block(100n)));
});
test('unsupported finalized or transport failure does not silently weaken settlement',async()=>{
 const failed={...rpc(90n),finalizedBlock:async()=>{throw Error('unavailable');}} as unknown as RpcTransport;
 await assert.rejects(settlementFinalizedUpper(failed,rpc(90n),block(100n)));
});
test('settlement delay is an explicit separate mode, never an implicit RPC failure downgrade',async()=>{
 const {settlementFinalityMode}=await import('../../packages/chain-worker/src/index.ts');
 assert.equal(settlementFinalityMode({}),'finalized');assert.equal(settlementFinalityMode({TG_SETTLEMENT_FINALITY:'delay'}),'delay');assert.throws(()=>settlementFinalityMode({TG_SETTLEMENT_FINALITY:'head'}));
});
