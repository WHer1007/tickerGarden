import test from 'node:test';
import assert from 'node:assert/strict';
import {searchHolderMarkets} from '../src/v1/holderMarkets.ts';
test('holder search validates directory and caches queries',async()=>{
 const original=globalThis.fetch;let calls=0;
 const item={marketId:'0x'+'a'.repeat(64),memeToken:'0x'+'b'.repeat(40),name:'Bloom',symbol:'BLOOM'};
 globalThis.fetch=async()=>{calls++;return new Response(JSON.stringify({chainId:46630,complete:true,items:[item]}))};
 try{assert.deepEqual(await searchHolderMarkets('http://localhost:1234',46630,'Bloom'),[item]);assert.deepEqual(await searchHolderMarkets('http://localhost:1234',46630,'Bloom'),[item]);assert.equal(calls,1);
 globalThis.fetch=async()=>new Response(JSON.stringify({chainId:1,complete:true,items:[]}));await assert.rejects(()=>searchHolderMarkets('http://localhost:1234',46630,'wrong'));
 let emptyCalls=0;globalThis.fetch=async()=>{emptyCalls++;return new Response(JSON.stringify({chainId:46630,complete:true,items:emptyCalls===1?[]:[item]}))};assert.deepEqual(await searchHolderMarkets('http://localhost:1234',46630,'empty'),[]);assert.deepEqual(await searchHolderMarkets('http://localhost:1234',46630,'empty'),[item]);assert.equal(emptyCalls,2);
 }finally{globalThis.fetch=original}
});
