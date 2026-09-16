import test from 'node:test';
import assert from 'node:assert/strict';
import {feeQuoteValue,feeUsdValue,formatFeeUsd} from '../src/v1/feeQuoteValue.ts';
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

test('USD fee valuation aggregates Quote and Meme assets using database prices',()=>{
 assert.equal(feeUsdValue([fee(quote,'1500000'),fee(meme,'2000000000000000000')],quote,meme,6,'0.25','3000.5'),'6001');
 assert.equal(feeUsdValue([fee(quote,'1000000000000000000')],quote,meme,18,null,'2500'),'2500');
 assert.equal(feeUsdValue([fee(meme,'1')],quote,meme,18,'0.000000002','3000'),'0.000000000000000000000006');
 assert.equal(feeUsdValue([],quote,meme,18,null,undefined),'0');
 for(const usd of [undefined,'0','-1','NaN'])assert.equal(feeUsdValue([fee(quote,'1')],quote,meme,18,null,usd),null);
 assert.equal(feeUsdValue([fee(meme,'1')],quote,meme,18,null,'3000'),null);
});
test('USD fee labels retain zero, missing valuation, small amounts and exact rounding',()=>{
 assert.equal(formatFeeUsd(null),'-');
 assert.equal(formatFeeUsd('0'),'$0.00');
 assert.equal(formatFeeUsd('0.0000001'),'<$0.01');
 assert.equal(formatFeeUsd('999.995'),'$1,000.00');
 assert.equal(formatFeeUsd('9007199254740993.12'),'$9,007,199,254,740,993.12');
});
