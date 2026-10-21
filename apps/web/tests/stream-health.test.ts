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

test('Explore stream lifecycle state initializes before router can unmount a page',async()=>{
 const {readFile}=await import('node:fs/promises');
 const source=await readFile(new URL('../src/app.ts',import.meta.url),'utf8');
 const initialized=source.indexOf('const exploreStreamHealth=createStreamHealth();');
 assert.ok(initialized>=0&&initialized<source.indexOf('router.start();'));
});
