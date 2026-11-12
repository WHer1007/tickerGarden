import test from 'node:test';import assert from 'node:assert/strict';
import {healthSync,readDisplayCoverage,recordDisplayGap} from '../../packages/confirmed-display/src/health.ts';
test('readable persisted snapshot never becomes verified live chain health',async()=>{
 const snapshot={status:'synced',blockNumber:'5',headBlockNumber:'5',headBlockHash:'hash',lagBlocks:'0'};
 assert.deepEqual(healthSync(snapshot),{...snapshot,status:'lagging',headBlockNumber:null,headBlockHash:null,lagBlocks:null});assert.equal(snapshot.status,'synced');
 const coverage=await readDisplayCoverage({query:async()=>({rows:[]})} as any,{environment:'production',chainId:56,deploymentDigest:'release'} as any,'unit');
 assert.equal(coverage.status,'unverified');assert.equal(coverage.synchronized,false);
 let calls=0;await assert.rejects(recordDisplayGap({query:async()=>{calls++;}} as any,{} as any,'unit','private error / invalid'));assert.equal(calls,0);
});
