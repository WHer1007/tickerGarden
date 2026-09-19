import test from 'node:test';import assert from 'node:assert/strict';
import {watchSubmissionDeadline} from '../src/v1/pendingRecovery.ts';
test('foreground expires at its persisted deadline even if RPC never answers',t=>{
 t.mock.timers.enable({apis:['setTimeout','Date'],now:18000});let expired=0;
 const stop=watchSubmissionDeadline(0,{current:()=>true,busy:()=>false,observation:()=>undefined,expire:()=>{expired++;}});
 t.mock.timers.tick(1999);assert.equal(expired,0);t.mock.timers.tick(1);assert.equal(expired,1);stop();
});
test('fresh observed pending preserves duplicate protection but stale evidence cannot lock forever',t=>{
 t.mock.timers.enable({apis:['setTimeout','Date'],now:20000});let expired=0;
 const stop=watchSubmissionDeadline(0,{current:()=>true,busy:()=>false,observation:()=>({state:'pending',checkedAt:20000}),expire:()=>{expired++;}});
 t.mock.timers.tick(0);assert.equal(expired,0);t.mock.timers.tick(15000);assert.equal(expired,1);stop();
});
test('stopped or changed wallet context cannot retire an operation',t=>{
 t.mock.timers.enable({apis:['setTimeout','Date'],now:0});let expired=0;
 const context={current:()=>false,busy:()=>false,observation:()=>undefined,expire:()=>{expired++;}};
 watchSubmissionDeadline(0,context);const stop=watchSubmissionDeadline(0,{...context,current:()=>true});stop();t.mock.timers.tick(20000);assert.equal(expired,0);
});
