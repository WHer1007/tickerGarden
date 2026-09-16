import test from 'node:test';
import assert from 'node:assert/strict';
import {confirmLaunch} from '../src/create/confirm-launch.ts';

test('cancel never starts publication or a wallet operation',async()=>{
 let calls=0;
 await confirmLaunch(()=> 'reviewed form',async()=>false,async()=>{calls++;});
 assert.equal(calls,0);
});
test('confirmation must still match the form and wallet before launch',async()=>{
 let current='original wallet and fields',calls=0;
 await assert.rejects(confirmLaunch(()=>current,async()=>{current='changed';return true;},async()=>{calls++;}),/changed/);
 assert.equal(calls,0);
});
test('unchanged confirmed launch proceeds once',async()=>{
 let calls=0;
 await confirmLaunch(()=> 'reviewed form',async()=>true,async()=>{calls++;});
 assert.equal(calls,1);
});
