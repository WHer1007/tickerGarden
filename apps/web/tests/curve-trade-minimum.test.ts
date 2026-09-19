import assert from 'node:assert/strict';
import {test} from 'node:test';
import {buildCurveBuyRequest,buildCurveSellRequest,toCurveProgressViewModel,verifyCurveTradeResponse} from '../src/v1/features/launch.ts';
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

test('confirmed quoted output is retained exactly in both Curve transaction requests',async()=>{
 const {quotedMinimum}=await import('../src/v1/tradeProtection.ts');
 const minimum=quotedMinimum(1234567890123456789n);
 assert.equal(buildCurveBuyRequest({marketResponse:response,quoteIn:10n,minTokensOut:minimum,recipient:address}).request.args?.[1],minimum);
 assert.equal(buildCurveSellRequest({marketResponse:response,tokensIn:10n,minQuoteOut:minimum,recipient:address}).request.args?.[1],minimum);
});


test('database head projections render progress without becoming transaction authority',()=>{
 const {observation,...display}=response;
 assert.equal(toCurveProgressViewModel(display).realQuoteReserve,1n);
 assert.throws(()=>buildCurveBuyRequest({marketResponse:display,quoteIn:10n,minTokensOut:1n,recipient:address}),/finalized/);
 assert.throws(()=>buildCurveSellRequest({marketResponse:display,tokensIn:10n,minQuoteOut:1n,recipient:address}),/finalized/);
 for(const sync of [
  {...display.sync,chainId:1},
  {...display.sync,status:'syncing'},
  {...display.sync,finality:'unknown'},
  {...display.sync,revision:`2:${hash}`},
  {...display.sync,blockHash:'0x1234'},
 ]) assert.throws(()=>toCurveProgressViewModel({...display,sync}));
 assert.throws(()=>toCurveProgressViewModel({...display,market:{...display.market,source:{...display.market.source,blockNumber:'2'}}}),/newer/);
});

test('a database head snapshot becomes builder input only after canonical verification',async()=>{
 const {observation,...display}=response;
 const calls:unknown[]=[];
 const verified=await verifyCurveTradeResponse(display,async market=>{calls.push(market);});
 assert.notEqual(verified,display);
 assert.equal(verified.sync.finality,'head');
 assert.equal(calls.length,1);
 assert.equal(calls[0],verified.market);
 assert.equal(buildCurveBuyRequest({marketResponse:verified,quoteIn:10n,minTokensOut:1n,recipient:address}).request.args?.[1],1n);
 assert.equal(buildCurveSellRequest({marketResponse:verified,tokensIn:10n,minQuoteOut:1n,recipient:address}).request.args?.[1],1n);
});

test('a failed canonical check grants no authority to a database head snapshot',async()=>{
 const {observation,...display}=response;
 await assert.rejects(verifyCurveTradeResponse(display,async()=>{throw Error('canonical route mismatch');}),/canonical route mismatch/);
 assert.throws(()=>buildCurveBuyRequest({marketResponse:display,quoteIn:10n,minTokensOut:1n,recipient:address}),/finalized/);
 assert.throws(()=>buildCurveSellRequest({marketResponse:display,tokensIn:10n,minQuoteOut:1n,recipient:address}),/finalized/);
});

test('mutating a verified snapshot invalidates its builder grant',async()=>{
 const {observation,...display}=response;
 const verified=await verifyCurveTradeResponse(display,async()=>{});
 (verified.market.canonicalRoute as any).router=`0x${'3'.repeat(40)}`;
 assert.throws(()=>buildCurveBuyRequest({marketResponse:verified,quoteIn:10n,minTokensOut:1n,recipient:address}),/finalized/);
 assert.throws(()=>buildCurveSellRequest({marketResponse:verified,tokensIn:10n,minQuoteOut:1n,recipient:address}),/finalized/);
});

test('a cloned verified snapshot cannot carry the process-local builder grant',async()=>{
 const {observation,...display}=response;
 const verified=await verifyCurveTradeResponse(display,async()=>{});
 const clone=structuredClone(verified);
 assert.throws(()=>buildCurveBuyRequest({marketResponse:clone,quoteIn:10n,minTokensOut:1n,recipient:address}),/finalized/);
 assert.throws(()=>buildCurveSellRequest({marketResponse:clone,tokensIn:10n,minQuoteOut:1n,recipient:address}),/finalized/);
});
