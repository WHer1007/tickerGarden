import test from 'node:test';import assert from 'node:assert/strict';
import {healthSync,readDisplayCoverage,recordDisplayGap} from '../../packages/confirmed-display/src/health.ts';
test('readable persisted snapshot never becomes verified live chain health',async()=>{
 const snapshot={status:'synced',blockNumber:'5',headBlockNumber:'5',headBlockHash:'hash',lagBlocks:'0'};
 assert.deepEqual(healthSync(snapshot),{...snapshot,status:'lagging',headBlockNumber:null,headBlockHash:null,lagBlocks:null});assert.equal(snapshot.status,'synced');
 const coverage=await readDisplayCoverage({query:async()=>({rows:[]})} as any,{environment:'production',chainId:56,deploymentDigest:'release'} as any,'unit');
 assert.equal(coverage.status,'unverified');assert.equal(coverage.synchronized,false);
 let calls=0;await assert.rejects(recordDisplayGap({query:async()=>{calls++;}} as any,{} as any,'unit','private error / invalid'));assert.equal(calls,0);
});

test('reconciled recorded events remain upstream-unverified and a later gap remains visible',async()=>{
 for(const status of ['gap','unverified'] as const){
  const coverage=await readDisplayCoverage({query:async()=>({rows:[{status,reason:'recorded-events-reconciled-upstream-unverified',updated_at:'2026-11-13T00:00:00Z'}]})} as any,{environment:'production',chainId:56,deploymentDigest:'release'} as any,'unit');
  assert.equal(coverage.status,status);assert.equal(coverage.synchronized,false);
 }
});
