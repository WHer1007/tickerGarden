import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createAssetPriceStore,parseAssetPriceSnapshot} from '../src/v1/assetPrices.ts';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const token=`0x${'1'.repeat(40)}`;
const reference=(status:'available'|'stale'|'unavailable',overrides:Record<string,unknown>={})=>({token,assetUid:`0x${'2'.repeat(64)}`,chainId:4663,symbol:'TSLA',source:'robinhood_rest',status,
 bidUsd:status==='available'?'99':'not-used',askUsd:status==='available'?'101':'not-used',multiplier:'1',unit:'USD_PER_WHOLE_TOKEN',
 asOf:'2020-01-01T00:00:00.000Z',expiresAt:'2020-01-01T00:20:00.000Z',retrievedAt:'2020-01-01T00:01:00.000Z',...overrides});
const response=(references:unknown[])=>({chainId:4663,displayOnly:true,confidence:'provider_reported',status:'configured',references});
test('display quotes retain backend status regardless of client clock or expiresAt',()=>{
 const snapshot=parseAssetPriceSnapshot(response([reference('available'),reference('stale',{token:`0x${'3'.repeat(40)}`}),reference('unavailable',{token:`0x${'4'.repeat(40)}`})]),4663);
 assert.equal(snapshot.prices[token]?.status,'available');assert.equal(snapshot.prices[token]?.midpointUsd,'100');
 assert.equal(snapshot.prices[`0x${'3'.repeat(40)}`]?.status,'stale');assert.equal(snapshot.prices[`0x${'4'.repeat(40)}`]?.status,'unavailable');
});
test('failed display-price refresh retains the last valid same-chain snapshot',async()=>{
 let fail=false;const store=createAssetPriceStore({baseUrl:'https://example.test',chainId:4663,fetcher:async()=>fail?new Response('unavailable',{status:503}):new Response(JSON.stringify(response([reference('available')])))});
 try{await store.refresh();const before=store.snapshot();fail=true;await store.refresh();assert.deepEqual(store.snapshot(),before);assert.equal(store.get(token)?.status,'available');}
 finally{store.stop();}
});
test('price subscription stays idle until needed, pauses on static routes and resumes',async(t)=>{
 const prior=Object.getOwnPropertyDescriptor(globalThis,'window');const events=new EventTarget();Object.defineProperty(globalThis,'window',{value:events,configurable:true});
 let reads=0;const store=createAssetPriceStore({baseUrl:'https://example.test',chainId:4663,fetcher:async()=>{reads++;return new Response(JSON.stringify({chainId:4663,displayOnly:true,confidence:'provider_reported',status:'configured',references:[]}));}});
 t.after(()=>{store.stop();if(prior)Object.defineProperty(globalThis,'window',prior);else Reflect.deleteProperty(globalThis,'window');});
 events.dispatchEvent(new Event('pageshow'));await tick();assert.equal(reads,0);
 store.start();store.start();await tick();assert.equal(reads,1);
 store.pause();events.dispatchEvent(new Event('online'));await tick();assert.equal(reads,1);
 store.start();await tick();assert.equal(reads,2);
});
