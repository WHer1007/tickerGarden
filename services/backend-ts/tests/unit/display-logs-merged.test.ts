import test from 'node:test';
import assert from 'node:assert/strict';
import {displayLogs} from '../../packages/confirmed-display/src/logs.ts';
import {eventTopicsForModules} from '../../packages/events/src/index.ts';
import type {RpcTransport} from '../../packages/chain/src/index.ts';

const address=(n:number)=>`0x${n.toString(16).padStart(40,'0')}`;
const poolManager='0x'+'f'.repeat(40);

test('merges mixed module addresses into fewer requests and filters address-topic mismatches',async()=>{
 const token=address(1),factory=address(2),wrong=address(3);
 const tokenTopic=eventTopicsForModules(['TickerMemeTokenV1'])[0];
 const factoryTopic=eventTopicsForModules(['TickerGardenFactoryV1'])[0];
 const calls:any[]=[];
 const rpc={call:async(_method:string,[filter]:any[])=>{
  calls.push(filter);
  return [
   {address:token,topics:[tokenTopic],tag:'token'},
   {address:factory,topics:[factoryTopic],tag:'factory'},
   {address:token,topics:[factoryTopic],tag:'wrong-topic-for-token'},
   {address:wrong,topics:[tokenTopic],tag:'wrong-address'},
   {address:poolManager,topics:[tokenTopic],tag:'pool-manager'},
  ];
 }} as unknown as RpcTransport;
 const logs=await displayLogs(rpc,new Map([[token,'TickerMemeTokenV1'],[factory,'TickerGardenFactoryV1'],[poolManager,'UniswapV4PoolManager']]),1n,1n);
 assert.equal(calls.length,1);
 assert.deepEqual(calls[0].address,[token,factory]);
 assert.deepEqual(new Set(calls[0].topics[0]),new Set([...eventTopicsForModules(['TickerMemeTokenV1']),...eventTopicsForModules(['TickerGardenFactoryV1'])]));
 assert.deepEqual(logs.map(log=>log.tag),['token','factory']);
});

test('chunks project addresses at 256 and retains bounded response splitting',async()=>{
 const addresses=Array.from({length:257},(_,i)=>address(i+10));
 const topic=eventTopicsForModules(['TickerMemeTokenV1'])[0];
 const calls:number[]=[];
 const rpc={call:async(_method:string,[filter]:any[])=>{
  calls.push(filter.address.length);
  assert.ok(filter.address.length<=256);
  if(filter.address.length>128)throw Error('RPC returned error code -32005');
  return filter.address.map((item:string)=>({address:item,topics:[topic]}));
 }} as unknown as RpcTransport;
 const logs=await displayLogs(rpc,new Map(addresses.map(item=>[item,'TickerMemeTokenV1'])),1n,1n);
 assert.deepEqual(logs.map(log=>log.address),addresses);
 assert.deepEqual(calls,[256,128,128,1]);
});
