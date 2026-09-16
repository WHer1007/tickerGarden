import assert from 'node:assert/strict';
import {test} from 'node:test';
import {parseProtocolStatistics,decimalProduct} from '../src/v1/protocolStatistics.ts';
import {statisticsUSD} from '../src/v1/statisticsValue.ts';
const asset='0x'+'1'.repeat(40);
const sample=()=>({schemaVersion:3,chainId:46630,displayOnly:true,usdBasis:'CURRENT_PRICE_ESTIMATE',feeBasis:'TRADE_TIME',observedAt:100,generatedAt:101,nextRefreshAt:1301,marketCount:0,bloomedMarketCount:0,launches24h:0,volumeCoverage:true,feeCoverage:true,allocationCoverage:true,stakingCoverage:true,volumeAmounts:{},feeTotals:{},feeDecimals:{},feePriceQuotes:{},feeAssets:{},stakingWallets:0,stakingObservedAt:100,stockAmounts:{}});
test('Stats accepts verified empty amounts and rejects wrong scope or malformed amounts',()=>{
 assert.equal(parseProtocolStatistics(sample(),46630).marketCount,0);
 for(const patch of [{chainId:4663},{volumeAmounts:{[asset]:'-1'}},{feeAssets:{[asset]:{creator:'1'}}},{stakingCoverage:false},{feePriceQuotes:{[asset]:{quoteAsset:asset,priceQuote:'NaN'}}}])assert.throws(()=>parseProtocolStatistics({...sample(),...patch},46630));
 assert.equal(parseProtocolStatistics({...sample(),stakingCoverage:false,stakingWallets:null,stakingObservedAt:null,stockAmounts:null},46630).stockAmounts,null);
});
test('Meme fee valuation multiplies its quote price once, retaining decimal precision',()=>{
 assert.equal(decimalProduct('0.25','12'),'3.00');
 assert.equal(statisticsUSD('2000000000000000000',18,decimalProduct('0.25','12'),200,100000),'6');
 const price=decimalProduct('0.123456789012345678901234567890123456','1.000000000000000001');
 assert.notEqual(statisticsUSD('1000000000000000000',18,price,200,100000),null);
});
