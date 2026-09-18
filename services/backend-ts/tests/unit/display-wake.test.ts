import test from 'node:test';
import assert from 'node:assert/strict';
import {DisplayWake,displayCatchup} from '../../packages/confirmed-display/src/wake.ts';

test('wake arriving before wait remains pending and wakes exactly one waiter',async()=>{
 const wake=new DisplayWake();wake.wake();
 let completed=false;
 await wake.wait(100,AbortSignal.timeout(1000));completed=true;
 assert.equal(completed,true);
 let timedOut=false;
 await wake.wait(5,AbortSignal.timeout(1000));timedOut=true;
 assert.equal(timedOut,true);
});

test('wake wait returns promptly on abort',async()=>{
 const wake=new DisplayWake(),controller=new AbortController();
 const waiting=wake.wait(10_000,controller.signal);
 controller.abort();
 await waiting;
});

test('catchup and initialization results are distinct from realtime confirmation',()=>{
 assert.equal(displayCatchup('catchup:100:2'),true);
 assert.equal(displayCatchup('initialized:25'),true);
 assert.equal(displayCatchup('confirmed:100:2'),false);
 assert.equal(displayCatchup('current'),false);
});
