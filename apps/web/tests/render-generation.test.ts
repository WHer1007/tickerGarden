import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRenderGeneration } from '../src/runtime/renderGeneration.ts';
test('late metadata cannot apply after snapshot replacement or filter change',()=>{
 let snapshot:object|null={revision:'one'};
 const renders=createRenderGeneration(()=>snapshot);
 const old=renders.begin();assert.equal(old.isCurrent(),true);
 snapshot={revision:'two'};assert.equal(old.isCurrent(),false);
 const next=renders.begin();const filtered=renders.begin();assert.equal(next.isCurrent(),false);assert.equal(filtered.isCurrent(),true);
 renders.invalidate();assert.equal(filtered.isCurrent(),false);
 const current=renders.begin();snapshot=null;assert.equal(current.isCurrent(),false);
});
test('late result stays invalid after same snapshot is restored',()=>{
 const snapshot={revision:'one'};const renders=createRenderGeneration(()=>snapshot);
 const before=renders.begin();renders.invalidate();const after=renders.begin();
 assert.equal(before.isCurrent(),false);assert.equal(after.isCurrent(),true);
});
