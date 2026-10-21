import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createStreamHealth} from '../src/v1/streamHealth.ts';
test('live stream suppresses four duplicate sweeps but always reconciles on fifth minute',()=>{
 let now=0;const health=createStreamHealth(()=>now);
 for(let i=1;i<=10;i++){now+=60000;health.signal();assert.equal(health.shouldReconcile(),i%5===0);}
});
test('missing heartbeat, stream failure and initial state preserve fallback',()=>{
 let now=0;const health=createStreamHealth(()=>now);
 assert.equal(health.shouldReconcile(),true);health.signal();assert.equal(health.shouldReconcile(),false);
 now=45000;assert.equal(health.shouldReconcile(),true);
 health.signal();health.reset();assert.equal(health.shouldReconcile(),true);
});
