import assert from 'node:assert/strict';
import test from 'node:test';
import {DisplayListener} from '../../packages/confirmed-display/src/listener.ts';

test('normal close and concurrent/repeated shutdown release the listener once',async()=>{
 const calls:unknown[]=[];const lease=new DisplayListener({query:async sql=>{calls.push(sql);},release:destroy=>{calls.push(destroy);}});
 await Promise.all([lease.close(),lease.close()]);await lease.close();lease.release(true);assert.deepEqual(calls,['UNLISTEN *',false]);
});
test('connection error during UNLISTEN destroys once and shutdown completes',async()=>{
 const releases:boolean[]=[];let lease:DisplayListener;
 lease=new DisplayListener({query:async()=>{await Promise.resolve();lease.release(true);throw Error('disconnected');},release:destroy=>releases.push(Boolean(destroy))});
 await lease.close();assert.deepEqual(releases,[true]);
});
test('an already disconnected or failed-initialization listener is not queried or released again',async()=>{
 let queries=0,releases=0;const lease=new DisplayListener({query:async()=>{queries++;},release:()=>{releases++;}});
 lease.release(true);lease.release(true);await lease.close();assert.equal(queries,0);assert.equal(releases,1);
});
test('UNLISTEN query rejection still releases ownership',async()=>{
 let releases=0;const lease=new DisplayListener({query:async()=>{throw Error('query failed');},release:()=>{releases++;}});
 await lease.close();assert.equal(releases,1);
});
