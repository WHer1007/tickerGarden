import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {verifyBatch,output} from './verify-arbitrum-continuous-simulation.mjs';
const fixture=()=>JSON.parse(fs.readFileSync(output+'/unsigned-transactions.json'));
test('reviewed unsigned streaming batch passes',()=>assert.equal(verifyBatch().components,16));
for(const [name,mutate] of [
 ['missing transaction',b=>b.transactions.pop()],
 ['wrong sender',b=>b.transactions[3].transaction.from='0x0000000000000000000000000000000000000001'],
 ['wrong nonce',b=>b.transactions[3].transaction.nonce='0x0'],
 ['wrong chain',b=>b.transactions[3].transaction.chainId='0x1237'],
 ['nonzero value',b=>b.transactions[3].transaction.value='0x1'],
 ['wrong target',b=>b.transactions[3].transaction.to=b.transactions[0].transaction.to],
 ['reordered components',b=>[b.transactions[4],b.transactions[5]]=[b.transactions[5],b.transactions[4]]],
 ['noncanonical padding',b=>{const t=b.transactions[16].transaction;t.input=t.input.slice(0,-2)+'ff';}],
 ['altered init code',b=>{const t=b.transactions[16].transaction;t.input=t.input.slice(0,202)+'ff'+t.input.slice(204);}],
 ['signed transaction',b=>b.transactions[0].hash='0x1234'],
 ['existing receipts',b=>b.receipts.push({})],
])test(name+' is rejected',()=>{const b=fixture();mutate(b);assert.throws(()=>verifyBatch(b));});
