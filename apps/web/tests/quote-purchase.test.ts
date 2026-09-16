import test from 'node:test';
import assert from 'node:assert/strict';
import {assertPurchaseWithinApproval,type PurchaseQuote} from '../src/create/quote-purchase.ts';
const quote:PurchaseQuote={chainId:4663,token:'0x5fc5360d0400a0fd4f2af552add042d716f1d168',amountIn:'100',amountOut:'200',stockInput:'100',blockNumber:'1',expiresAt:Date.now()+60000,priceImpactBps:10};
test('refresh can reduce the shortfall but cannot increase accepted ETH or asset purchase',()=>{
 assert.doesNotThrow(()=>assertPurchaseWithinApproval({...quote,amountIn:'90',amountOut:'180'},quote));
 for(const fresh of [{...quote,amountIn:'101'},{...quote,amountOut:'201'},{...quote,token:'0x1111111111111111111111111111111111111111' as const}])assert.throws(()=>assertPurchaseWithinApproval(fresh,quote),/Purchase cost changed/);
 assert.throws(()=>assertPurchaseWithinApproval(quote,undefined),/Purchase cost changed/);
});
