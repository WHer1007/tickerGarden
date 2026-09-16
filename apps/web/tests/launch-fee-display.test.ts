import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createLaunchFeeDisplay} from '../src/create/launch-fee-display.ts';
test('fee display works without wallet state, coalesces reads and refreshes expired values',async()=>{
 let calls=0,time=0,fee=123n;
 const reader=createLaunchFeeDisplay(async()=>{calls++;return fee;},()=>time);
 assert.equal(reader.peek(),null);
 assert.deepEqual(await Promise.all([reader.load(),reader.load()]),[123n,123n]);assert.equal(calls,1);
 fee=0n;assert.equal(await reader.load(),123n);time=60001;assert.equal(reader.peek(),null);
 assert.equal(await reader.load(),0n);assert.equal(calls,2);
});
test('failed or malformed fee is never presented as free and can be retried',async()=>{
 let time=0,fail=true;
 const reader=createLaunchFeeDisplay(async()=>{if(fail)throw Error('RPC unavailable');return 55n;},()=>time);
 assert.equal(await reader.load(),null);fail=false;time=5001;assert.equal(await reader.load(),55n);
 assert.equal(await createLaunchFeeDisplay(async()=>-1n).load(),null);
 assert.equal(await createLaunchFeeDisplay(async()=>'0').load(),null);
});
