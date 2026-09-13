import assert from 'node:assert/strict';
import test from 'node:test';
import {createDetailActivity} from '../src/v1/detailActivity.ts';
const hash=`0x${'1'.repeat(64)}` as const;
const id={marketId:hash,memeToken:`0x${'2'.repeat(40)}`,quoteAsset:`0x${'3'.repeat(40)}`,quoteDecimals:18,symbol:'T',quoteSymbol:'ETH'};
const source={provider:'indexer',asOf:Math.floor(Date.now()/1000),blockNumber:'10',blockHash:hash};
const payload=(seen=false)=>({version:1,chainId:46630,displayOnly:true,...id,period:'1H',statistics:null,chart:null,holders:null,trades:seen?[{timestamp:source.asOf,side:'buy',price:'1',memeRaw:'1',quoteRaw:'1',actor:null,txHash:hash,eventKey:'event-1',classification:'unclassified'}]:[],fees:[],sources:{trades:source,fees:source},reasons:{}});
const flush=()=>new Promise<void>(resolve=>setImmediate(resolve));
test('activity is coalesced and cannot query charts or summary sections',async()=>{
 let release!:(r:Response)=>void;const calls:URL[]=[];let updates=0;
 const loader=createDetailActivity('https://read.example',46630,id,()=>updates++,async input=>{calls.push(new URL(String(input)));return new Promise(r=>release=r);});
 const first=loader.refresh(),second=loader.refresh(true);assert.equal(first,second);
 release(Response.json(payload()));await first;assert.equal(updates,1);
 assert.equal(calls[0]!.searchParams.get('section'),'activity');
 await loader.refresh();assert.equal(calls.length,1);loader.stop();
});
test('receipt retries old database state and stops when the indexed transaction appears',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});let calls=0,updates=0;
 const loader=createDetailActivity('https://read.example',46630,id,()=>updates++,async()=>Response.json(payload(++calls===2)));
 t.after(()=>loader.stop());loader.seed();loader.receipt(hash);await flush();assert.equal(calls,1);
 t.mock.timers.tick(2000);await flush();assert.equal(calls,2);assert.equal(updates,2);
 t.mock.timers.tick(300000);await flush();assert.equal(calls,2);
});
test('activity stop aborts requests and rejects late data from the previous market',async()=>{
 let release!:(r:Response)=>void,signal:AbortSignal|undefined;let updates=0;
 const loader=createDetailActivity('https://read.example',46630,id,()=>updates++,async(_input,init)=>{signal=init?.signal as AbortSignal;return new Promise(r=>release=r);});
 const pending=loader.refresh();loader.stop();assert.equal(signal?.aborted,true);release(Response.json(payload()));await pending;assert.equal(updates,0);
});
