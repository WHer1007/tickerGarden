import test from 'node:test';
import assert from 'node:assert/strict';
import {feeQuoteValue} from '../src/v1/feeQuoteValue.ts';
const quote='0x0000000000000000000000000000000000000000',meme='0x1111111111111111111111111111111111111111';
const fee=(asset:typeof quote|typeof meme,amountRaw:string)=>({recipient:'creator' as const,asset,amountRaw});
test('values mixed fee assets in Quote units without floating point loss',()=>{
 assert.equal(feeQuoteValue([fee(quote,'1500000'),fee(meme,'2000000000000000000')],quote,meme,6,'0.25'),'2');
 assert.equal(feeQuoteValue([fee(meme,'1')],quote,meme,18,'0.000000002'),'0.000000000000000000000000002');
});
test('zero fees need no price; nonzero meme fees require a valid price',()=>{
 assert.equal(feeQuoteValue([],quote,meme,18,null),'0');
 assert.equal(feeQuoteValue([fee(quote,'1000000000000000000')],quote,meme,18,null),'1');
 assert.equal(feeQuoteValue([fee(meme,'1')],quote,meme,18,null),null);
 assert.equal(feeQuoteValue([fee(meme,'1')],quote,meme,18,'0'),null);
 assert.equal(feeQuoteValue([fee(quote,'-1')],quote,meme,18,'1'),null);
});
