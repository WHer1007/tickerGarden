import test from 'node:test';
import assert from 'node:assert/strict';
import {displayLogs} from '../../packages/confirmed-display/src/logs.ts';
import {eventTopicsForModules} from '../../packages/events/src/index.ts';
import type {RpcTransport} from '../../packages/chain/src/index.ts';

test('merged confirmed display log queries retain scoped addresses, union topics, and 256-address chunks',async()=>{
 const tokens=Array.from({length:257},(_,i)=>`0x${(i+1).toString(16).padStart(40,'0')}`);
 const factory='0x'+'f'.repeat(40);
 const calls:any[]=[];
 const rpc={call:async(_method:string,[filter]:any[])=>{
  assert.ok(Array.isArray(filter.address),'address filter is required');
  assert.ok(filter.address.length>0&&filter.address.length<=256);
  assert.ok(Array.isArray(filter.topics?.[0])&&filter.topics[0].length>0,'module event topics are required');
  assert.deepEqual(new Set(filter.topics[0]),new Set([...eventTopicsForModules(['TickerMemeTokenV1']),...eventTopicsForModules(['TickerGardenFactoryV1'])]));
  calls.push(filter);
  return filter.address.map((address:string)=>({address,topics:[address===factory?eventTopicsForModules(['TickerGardenFactoryV1'])[0]:eventTopicsForModules(['TickerMemeTokenV1'])[0]],block:filter.fromBlock}));
 }} as unknown as RpcTransport;
 const logs=await displayLogs(rpc,new Map([...tokens.map(address=>[address,'TickerMemeTokenV1'] as const),[factory,'TickerGardenFactoryV1'] as const]),10n,10n);
 assert.deepEqual(logs.map(log=>log.address),[...tokens,factory]);
 assert.ok(calls.every((filter)=>Array.isArray(filter.address)&&filter.address.length<=256));
 assert.ok(calls.every((filter)=>filter.topics?.[0]?.length));
 assert.deepEqual(calls.map(filter=>filter.address.length),[256,2]);
});
