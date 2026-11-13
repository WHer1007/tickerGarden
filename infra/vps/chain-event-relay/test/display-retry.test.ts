import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
import {parseEventFilter,parseSubscriptionLog,serializeTrigger} from '../src/core.ts';import {replayDisplayBatch} from '../src/display-retry.ts';
const filter=parseEventFilter(JSON.parse(await readFile(new URL('../filter.json',import.meta.url),'utf8'))),hash='0x'+'1'.repeat(64) as `0x${string}`;
const log=parseSubscriptionLog({address:filter.fixedAddresses[0],blockHash:hash,blockNumber:'0x10',transactionHash:hash,transactionIndex:'0x0',logIndex:'0x3',topics:[filter.eventTopics[0]],data:'0x',removed:false});
const row={payload:serializeTrigger(filter,log,{number:16n,hash})};
test('retry restores persisted logs before delivery and validates the entire bounded batch first',async()=>{
 let writes=0;await assert.rejects(replayDisplayBatch([row],filter,async()=>{throw Error('database offline');}),/database offline/);
 await replayDisplayBatch([row],filter,async recovered=>{assert.deepEqual(recovered,log);writes++;});assert.equal(writes,1);
 const wrong={payload:JSON.stringify({...JSON.parse(row.payload),chainId:1})};await assert.rejects(replayDisplayBatch([row,wrong],filter,async()=>{writes++;}),/identity mismatch/);assert.equal(writes,1);
 await assert.rejects(replayDisplayBatch(Array(257).fill(row),filter,async()=>{writes++;}),/batch size/);assert.equal(writes,1);
});
