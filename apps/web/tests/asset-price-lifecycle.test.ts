import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createAssetPriceStore} from '../src/v1/assetPrices.ts';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
test('price subscription stays idle until needed, pauses on static routes and resumes',async(t)=>{
 const prior=Object.getOwnPropertyDescriptor(globalThis,'window');const events=new EventTarget();Object.defineProperty(globalThis,'window',{value:events,configurable:true});
 let reads=0;const store=createAssetPriceStore({baseUrl:'https://example.test',chainId:4663,fetcher:async()=>{reads++;return new Response(JSON.stringify({chainId:4663,displayOnly:true,confidence:'provider_reported',status:'configured',references:[]}));}});
 t.after(()=>{store.stop();if(prior)Object.defineProperty(globalThis,'window',prior);else Reflect.deleteProperty(globalThis,'window');});
 events.dispatchEvent(new Event('pageshow'));await tick();assert.equal(reads,0);
 store.start();store.start();await tick();assert.equal(reads,1);
 store.pause();events.dispatchEvent(new Event('online'));await tick();assert.equal(reads,1);
 store.start();await tick();assert.equal(reads,2);
});
