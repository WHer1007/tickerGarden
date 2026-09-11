import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validStakeAmountDraft} from '../src/ui/stake-amount-input.ts';
test('allows decimal editing but rejects unsupported syntax and excessive precision',()=>{
 for(const value of ['', '0', '0.', '.5', '12.345678'])assert.equal(validStakeAmountDraft(value,6),true,value);
 for(const value of ['-1','1e3','1,000','1 2','abc','1..2','00','1.1234567'])assert.equal(validStakeAmountDraft(value,6),false,value);
 assert.equal(validStakeAmountDraft('1.0',0),false);
});
test('blocks values beyond the on-chain integer bound',()=>{
 const max=(1n<<256n)-1n;
 assert.equal(validStakeAmountDraft(max.toString(),0),true);
 assert.equal(validStakeAmountDraft((max+1n).toString(),0),false);
 assert.equal(validStakeAmountDraft('9'.repeat(81),18),false);
});
