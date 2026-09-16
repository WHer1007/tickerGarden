import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createCoalescedRefresh} from '../src/v1/coalescedRefresh.ts';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
test('snapshot refresh coalesces bursts into one follow-up without overlap',async()=>{
 let calls=0;const releases:Array<()=>void>=[];
 const queue=createCoalescedRefresh(()=>{calls++;return new Promise<void>(resolve=>releases.push(resolve));});
 queue.request();await tick();for(let i=0;i<20;i++)queue.request();assert.equal(calls,1);
 releases.shift()!();await tick();assert.equal(calls,2);releases.shift()!();await tick();assert.equal(calls,2);
});
test('cancel suppresses queued work and old completion cannot restart it',async()=>{
 let calls=0;const releases:Array<()=>void>=[];const queue=createCoalescedRefresh(()=>{calls++;return new Promise<void>(resolve=>releases.push(resolve));});
 queue.request();await tick();queue.request();queue.cancel();queue.request();await tick();assert.equal(calls,2);
 releases.shift()!();await tick();assert.equal(calls,2);releases.shift()!();await tick();assert.equal(calls,2);
 queue.request();queue.cancel();await tick();assert.equal(calls,2);
});
test('failed refresh does not prevent later notifications',async()=>{
 let calls=0;const queue=createCoalescedRefresh(async()=>{calls++;throw new Error('offline');});queue.request();await tick();queue.request();await tick();assert.equal(calls,2);
});
