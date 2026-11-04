import test from 'node:test';
import assert from 'node:assert/strict';
import {assertBscEntryCapacity,verifyBscEntry} from '../src/chains/bsc/risk.ts';
test('BSC issuer restrictions and custody capacity reject new deposits without blocking exit builders',()=>{
 for(let status=1;status<=8;status++)assert.throws(()=>assertBscEntryCapacity(status,[100n,20n],1n,1n,1n));
 assert.throws(()=>assertBscEntryCapacity(0,[100n,20n],100n,1n,1n));
 assert.throws(()=>assertBscEntryCapacity(0,[100n,20n],1n,20n,1n));
 assert.doesNotThrow(()=>assertBscEntryCapacity(0,[(1n<<256n)-1n,(1n<<256n)-1n],100n,20n,1n));
});
test('BSC entry checks pin all four reads to the same active-request block',async()=>{
 const calls:any[]=[];const client={getBlockNumber:async()=>123n,readContract:async(r:any)=>{calls.push(r);return r.functionName==='stockEntryStatus'?0:r.functionName==='bscStockDepositLimits'?[100n,20n]:1n;}};
 await verifyBscEntry(client,'0x'+'1'.repeat(40) as any,'0x'+'2'.repeat(40) as any,'0x'+'3'.repeat(64) as any,'0x'+'4'.repeat(40) as any,2n);
 assert.equal(calls.length,4);assert.ok(calls.every(r=>r.blockNumber===123n));
});
