import assert from 'node:assert/strict';
import {test} from 'node:test';
import {buildCurveBuyRequest,buildCurveSellRequest} from '../src/v1/features/launch.ts';
import {ROBINHOOD_CHAIN_ID} from '../src/v1/chain.ts';
const address=`0x${'1'.repeat(40)}` as const,hash=`0x${'2'.repeat(64)}`;
const response={observation:'direct-chain',sync:{chainId:ROBINHOOD_CHAIN_ID,status:'synced',finality:'head',blockNumber:'1',blockHash:hash,revision:`1:${hash}`},market:{marketId:hash,assetUid:hash,quoteAssetConfigId:hash,tickerGardenBaselineId:hash,curve:address,memeToken:address,quoteAsset:'0x0000000000000000000000000000000000000000',launchPhase:0,sourceVersion:1,source:{chainId:ROBINHOOD_CHAIN_ID,blockNumber:'1',blockHash:hash,transactionHash:hash,transactionIndex:0,logIndex:0},canonicalRoute:{router:address,quoter:address,hook:address,launchLocker:address,graduationExecutor:address,sourceVersion:1,launchPhase:0,curveTradingEnabled:true},curveProgress:{realQuoteReserve:'1',sellableTokens:'1',reservedTokens:'1',accruedCurveFees:'0',readyToGraduate:false}}} as any;
test('curve trades accept zero minimum while rejecting negative minimum and zero input',()=>{
 const buy=buildCurveBuyRequest({marketResponse:response,quoteIn:10n,minTokensOut:0n,recipient:address});
 const sell=buildCurveSellRequest({marketResponse:response,tokensIn:10n,minQuoteOut:0n,recipient:address});
 assert.equal(buy.request.args?.[1],0n);assert.equal(sell.request.args?.[1],0n);
 assert.throws(()=>buildCurveBuyRequest({marketResponse:response,quoteIn:10n,minTokensOut:-1n,recipient:address}),/uint256/);
 assert.throws(()=>buildCurveSellRequest({marketResponse:response,tokensIn:0n,minQuoteOut:0n,recipient:address}),/positive/);
});
