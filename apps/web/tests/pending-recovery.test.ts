import test from 'node:test';
import assert from 'node:assert/strict';
import {watchPendingRecovery,pendingRecoveryText} from '../src/v1/pendingRecovery.ts';
test('unknown and legacy saved hashes never claim to be confirming',()=>{
 for(const stage of ['unknown',undefined])assert.doesNotMatch(pendingRecoveryText(stage,false),/confirming|submitted/);
 assert.match(pendingRecoveryText('pending',true),/Checking token approval status/);
 assert.match(pendingRecoveryText('replaced',false,true),/Cancellation/);
});
test('automatic recovery never overlaps probes and stops after disposal',async()=>{
 let calls=0,finish!:()=>void;
 const stop=watchPendingRecovery(()=>{calls++;return new Promise<void>(r=>{finish=r;});},5);
 await new Promise(r=>setTimeout(r,20));assert.equal(calls,1);
 stop();finish();await new Promise(r=>setTimeout(r,20));assert.equal(calls,1);
});
test('a transient RPC failure does not stop subsequent automatic checks',async()=>{
 let calls=0;let done!:()=>void;const completed=new Promise<void>(r=>done=r);
 const stop=watchPendingRecovery(async()=>{if(++calls===1)throw Error('RPC unavailable');done();},5);
 try{await completed;assert.equal(calls,2);}finally{stop();}
});
