import test from 'node:test';import assert from 'node:assert/strict';import {createIdleClaimer} from '../src/idle-claim.ts';
test('eight idle publishers share one probe but real deliveries get distinct claims',async()=>{
 let now=0,rev=0,calls=0;const jobs:number[]=[];const claim=createIdleClaimer(async()=>{calls++;return jobs.shift();},()=>rev,()=>now);
 assert.deepEqual(await Promise.all(Array.from({length:8},()=>claim())),Array(8).fill(undefined));assert.equal(calls,1);
 now=500;await Promise.all(Array.from({length:8},()=>claim()));assert.equal(calls,2);
 jobs.push(1,2,3);rev++;const results=await Promise.all(Array.from({length:8},()=>claim()));assert.deepEqual(results.filter(x=>x!==undefined),[1,2,3]);assert.equal(calls,6);
});
test('a notification racing an empty query is not swallowed',async()=>{
 let rev=0,calls=0;const claim=createIdleClaimer(async()=>{calls++;if(calls===1){rev++;return undefined;}return 1;},()=>rev,()=>0);
 assert.equal(await claim(),undefined);assert.equal(await claim(),1);assert.equal(calls,2);
});
