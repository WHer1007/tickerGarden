import {test} from 'node:test';
import assert from 'node:assert/strict';
import {statisticsQuoteLabel} from '../src/v1/statsQuote.ts';
const address='0x'+'1'.repeat(40);
test('statistics quote fallback preserves raw units when RPC metadata fails',async()=>{
 const p=await statisticsQuoteLabel(address,1000000n,async()=>{throw new Error('RPC unavailable')});assert.equal(p.label,address);assert.equal(p.amount,'1000000 raw · token decimals unavailable');
 for(const precision of [null,'6',-1,256,1.5,NaN])assert.match((await statisticsQuoteLabel(address,1000000n,async()=>['USD',precision])).amount,/decimals unavailable/);
});
test('statistics quote formatting preserves exact native and token precision',async()=>{
 assert.equal((await statisticsQuoteLabel(address,1000001n,async()=>['USD',6])).amount,'1.000001 (1000001 raw)');
 assert.equal((await statisticsQuoteLabel(address,1000000000000000001n,async()=>['TOK',18])).amount,'1.000000000000000001 (1000000000000000001 raw)');
 assert.equal((await statisticsQuoteLabel(address,12n,async()=>['TOK',0])).amount,'12 (12 raw)');
 const native=await statisticsQuoteLabel('0x'+'0'.repeat(40),1n,async()=>{throw new Error('must not read')});assert.equal(native.label,'ETH');assert.equal(native.amount,'0.000000000000000001 (1 raw)');
 assert.equal((await statisticsQuoteLabel(address,1n,async()=>['',6])).label,address);
});
