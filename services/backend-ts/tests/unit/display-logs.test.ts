import test from 'node:test';
import assert from 'node:assert/strict';
import {displayLogs} from '../../packages/confirmed-display/src/logs.ts';
import {eventTopicsForModules} from '../../packages/events/src/index.ts';
import type {RpcTransport} from '../../packages/chain/src/index.ts';
const token='0x'+'1'.repeat(40);
test('generic Transfer queries only project tokens and splits oversized ranges without loss',async()=>{
 const calls:any[]=[];const tokenTopic=eventTopicsForModules(['TickerMemeTokenV1'])[0];const factoryTopic=eventTopicsForModules(['TickerGardenFactoryV1'])[0];
 const rpc={call:async(_method:string,[filter]:any[])=>{calls.push(filter);assert.deepEqual(filter.address,[token,'factory']);assert.deepEqual(new Set(filter.topics[0]),new Set([...eventTopicsForModules(['TickerMemeTokenV1']),...eventTopicsForModules(['TickerGardenFactoryV1'])]));if(filter.fromBlock!==filter.toBlock)throw Error('RPC response exceeds size limit');return [{address:token,topics:[tokenTopic],block:filter.fromBlock},{address:'factory',topics:[factoryTopic],kind:'factory'}];}} as unknown as RpcTransport;
 const logs=await displayLogs(rpc,new Map([[token,'TickerMemeTokenV1'],['factory','TickerGardenFactoryV1']]),1n,2n);
 assert.deepEqual(logs,[{address:token,topics:[tokenTopic],block:'0x1'},{address:'factory',topics:[factoryTopic],kind:'factory'},{address:token,topics:[tokenTopic],block:'0x2'},{address:'factory',topics:[factoryTopic],kind:'factory'}]);assert.equal(calls.length,3);
});
test('single-block transfer batches split on size limits; other errors propagate',async()=>{
 const tokens=Array.from({length:257},(_,i)=>`0x${i.toString(16).padStart(40,'0')}`);const calls:number[]=[];
 const topic=eventTopicsForModules(['TickerMemeTokenV1'])[0];
 const rpc={call:async(_method:string,[f]:any[])=>{calls.push(f.address.length);assert.ok(f.address.length<=256);if(f.address.length>128)throw Error('RPC returned error code -32005');return f.address.map((address:string)=>({address,topics:[topic]}));}} as unknown as RpcTransport;
 const result=await displayLogs(rpc,new Map(tokens.map(t=>[t,'TickerMemeTokenV1'])),1n,1n);assert.deepEqual(result.map(r=>r.address),tokens);assert.deepEqual(calls,[256,128,128,1]);
 await assert.rejects(()=>displayLogs({call:async()=>{throw Error('RPC HTTP 401');}} as unknown as RpcTransport,new Map([[token,'TickerMemeTokenV1']]),1n,2n),/401/);
});
