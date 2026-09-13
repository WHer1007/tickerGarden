import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
const app=readFileSync(new URL('../src/app.ts',import.meta.url),'utf8');
const widget=readFileSync(new URL('../src/v1/tokenDetailWidget.ts',import.meta.url),'utf8');
function section(start:string,end:string){return app.slice(app.indexOf(start),app.indexOf(end,app.indexOf(start)+start.length));}
test('public browsing and statistics never probe RPC or explorer history',()=>{
 for(const [start,end] of [
  ['async function prepareFoundation','async function verifyTransactionFoundation'],
  ['async function marketMetadata','const homeRender'],
  ['function exploreIdentity','function setupMarkets'],
  ['async function refreshMarketOverview','let tradeStakeAccount'],
  ['async function refreshTradeStake','function renderDetailStakingSymbol'],
  ['async function renderTradeFeeDetails','function scheduleTradeQuote'],
  ['async function refreshRecentTrades','let tradeFieldsGeneration'],
  ['async function refreshDirectDirectory','let directDirectoryTimer'],
 ]){
  const body=section(start!,end!);assert.ok(body.length>0,start);
  assert.doesNotMatch(body,/publicClient\.|explorerRecentTrades\(|explorerCurveVolume24h\(/,start);
 }
 assert.doesNotMatch(section('async function loadTradeMarket','async function renderTradeFeeDetails'),/void verifyTradeMarket|publicClient\./);
 assert.doesNotMatch(app,/Trading is ready in the Uniswap v4 pool\. Quotes refresh every 30 seconds\./);
});
test('historical widgets use database series and never live transaction overrides',()=>{
 assert.match(widget,/const currentChart=\(\)=>chartData/);
 assert.match(widget,/const visibleTrades=activity\?\.trades\?\?data\?\.trades\?\?\[\]/);
 assert.doesNotMatch(widget,/const exactPrice=tradePrice|feeQuoteValue\([^;]*tradePrice/);
 assert.match(app,/if\(!tradeMarketVerified\)\{await verifyTradeMarket/);
});

test('period selection requests only the chart and preserves independent summary state',()=>{
 const start=widget.indexOf("for(const b of root.querySelectorAll<HTMLButtonElement>('[data-detail-period]'))");
 const handler=widget.slice(start,widget.indexOf(" q('[data-detail-more-trades]')",start));
 assert.match(handler,/void refreshChart\(\)/);
 assert.doesNotMatch(handler,/void refresh\(|render\(|data=null|cache.clear/);
 const refresh=widget.slice(widget.indexOf(' const refreshChart='),widget.indexOf(' // Fetch analytics while'));
 assert.match(refresh,/loadDetailChart/);assert.doesNotMatch(refresh,/getTokenDetail|render\(/);
 assert.match(refresh,/own!==chartGeneration/);
});

test('detail bootstrap and background display refresh do not wait for wallet RPC',()=>{
 const load=section('async function loadTradeMarket','async function renderTradeFeeDetails');
 assert.doesNotMatch(load,/await loadDetailBalances|await verifyTradeMarket|await refreshRecentTrades|await loadDetailContent/);
 const verify=section('async function verifyTradeMarket','async function loadDetailContent');
 assert.doesNotMatch(verify,/renderTradeFeeDetails|refreshRecentTrades|refreshMarketOverview/);
 const fields=section('async function refreshTradeFields','function completeTradeDisplay');
 assert.match(fields,/if\(!background\)void loadDetailBalances\(true\)/);
 assert.match(app,/await refreshCurrentPage\(needsFoundation\)/);
 assert.match(app,/directoryMarketId\s*\? readPublishedMarket/);
 assert.match(app,/foundation.directoryMarketId && route.page !== "trade"/);
});
