import assert from 'node:assert/strict';
import {test} from 'node:test';
import {creatorTaxBps,assertCreatorTaxSupported,MAX_CREATOR_TAX_BPS} from '../src/create/options.ts';
test('creator tax input uses exact basis points and rejects out-of-range precision',()=>{
 assert.equal(MAX_CREATOR_TAX_BPS,500);
 for(const [input,expected] of [['0',0],['0.01',1],['2.5',250],['5',500]] as const) assert.equal(creatorTaxBps(input),expected);
 for(const input of ['5.01','10','-1','0.001','1e2']) assert.throws(()=>creatorTaxBps(input));
 assert.doesNotThrow(()=>assertCreatorTaxSupported(0));
 assert.doesNotThrow(()=>assertCreatorTaxSupported(500));
 for (const bps of [-1,501,1000,0.5,NaN]) assert.throws(()=>assertCreatorTaxSupported(bps));
});
