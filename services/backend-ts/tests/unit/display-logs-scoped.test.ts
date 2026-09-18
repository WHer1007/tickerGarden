import test from 'node:test';
import assert from 'node:assert/strict';
import {displayLogs} from '../../packages/confirmed-display/src/logs.ts';
import {eventTopicsForModules} from '../../packages/events/src/index.ts';
import type {RpcTransport} from '../../packages/chain/src/index.ts';

test('every confirmed display log query has module topics and at most 256 scoped addresses',async()=>{
 const tokens=Array.from({length:257},(_,i)=>`0x${(i+1).toString(16).padStart(40,'0')}`);
 const factory='0x'+'f'.repeat(40);
 const calls:Array<{filter:any;module:string}>=[];
 const rpc={call:async(_method:string,[filter]:any[])=>{
  assert.ok(Array.isArray(filter.address),'address filter is required');
  assert.ok(filter.address.length>0&&filter.address.length<=256);
  assert.ok(Array.isArray(filter.topics?.[0])&&filter.topics[0].length>0,'module event topics are required');
  const module=filter.address.includes(factory)?'TickerGardenFactoryV1':'TickerMemeTokenV1';
  assert.deepEqual(filter.topics[0],eventTopicsForModules([module]));
  calls.push({filter,module});
  return filter.address.map((address:string)=>({address,block:filter.fromBlock}));
 }} as unknown as RpcTransport;
 const logs=await displayLogs(rpc,new Map([...tokens.map(address=>[address,'TickerMemeTokenV1'] as const),[factory,'TickerGardenFactoryV1'] as const]),10n,10n);
 assert.deepEqual(logs.map(log=>log.address),[...tokens,factory]);
 assert.ok(calls.every(({filter})=>Array.isArray(filter.address)&&filter.address.length<=256));
 assert.ok(calls.every(({filter})=>filter.topics?.[0]?.length));
 assert.deepEqual(calls.filter(({module})=>module==='TickerMemeTokenV1').map(({filter})=>filter.address.length),[256,1]);
 assert.deepEqual(calls.filter(({module})=>module==='TickerGardenFactoryV1').map(({filter})=>filter.address.length),[1]);
});
