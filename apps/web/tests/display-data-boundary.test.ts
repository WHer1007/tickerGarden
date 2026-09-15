import {controllerFunction,controllerSources} from './controller-source.ts';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
const app=controllerSources.join('\n');
const widget=readFileSync(new URL('../src/v1/tokenDetailWidget.ts',import.meta.url),'utf8');
function section(start:string,end:string){return controllerFunction(start.match(/function (\w+)/)![1]!);}
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
 assert.match(load,/\(!readApi && !foundation\.direct\)/);
 assert.match(load,/foundation\.direct && directMarkets/);
 assert.doesNotMatch(load,/await loadDetailBalances|await verifyTradeMarket|await refreshRecentTrades|await loadDetailContent/);
 const verify=section('async function verifyTradeMarket','async function loadDetailContent');
 assert.doesNotMatch(verify,/renderTradeFeeDetails|refreshRecentTrades|refreshMarketOverview/);
 const fields=section('async function refreshTradeFields','function completeTradeDisplay');
 assert.match(fields,/\(!readApi&&!\(foundation\.direct&&directMarkets\)\)/);
 assert.match(fields,/if\(!background\)void loadDetailBalances\(true\)/);
 const complete=section('function completeTradeDisplay','async function submitTrade');
 assert.match(complete,/tradeMarket\.market\.marketId!==market\.market\.marketId/);
 assert.doesNotMatch(complete,/tradeMarket!==market/);
 assert.match(complete,/void loadDetailBalances\(false\)/);
 assert.match(app,/await refreshCurrentPage\(needsFoundation\)/);
 assert.match(app,/directoryMarketId\s*\? readPublishedMarket/);
 assert.match(app,/foundation.directoryMarketId && route.page !== "trade"/);
});

test('local direct detail converges unavailable historical widgets instead of loading forever',()=>{
 assert.match(widget,/if\(id&&!base\)\{chartData=null;chartState='error';renderChartChange\(\);\}/);
});

test('local Creator rewards read the verified direct market without a Read API',()=>{
 const detail=section('async function getRewardMarketDetail','// Claim mode is immutable');
 assert.match(detail,/\(!readApi && !foundation\.direct\)/);
 assert.match(detail,/foundation\.direct[\s\S]*directMarkets\?\.market/);
 const creator=section('async function refreshCreatorReward','function clearTreasuryProof');
 assert.doesNotMatch(creator,/Locked —/);
 assert.match(creator,/Creator rewards could not be loaded\. Refresh and try again\./);
});

test('Claim token options keep the complete token address in their label and title',()=>{
 const label=section('function rewardMarketOptionLabel','const holderHistoryCache');
 assert.match(label,/currentPage\(\)==='rewards'[^\n]+market\.memeToken/);
 assert.doesNotMatch(label,/currentPage\(\)==='rewards'[^\n]+shortHex/);
 const populate=section('function populateRewardMarkets','function syncRewardMarketSelections');
 assert.match(populate,/metadata\.symbol} · \$\{market\.memeToken}/);
 assert.match(populate,/option\.title=market\.memeToken/);
});

test('Holder rewards uses one token-selection prompt',()=>{
 const availability=section('function updateRewardsAvailability','function updateRewardCountdowns');
 assert.doesNotMatch(availability,/Select A Token To View Rewards/);
 assert.match(app,/Select a token to view its reward distribution\./);
});

test('Creator reward assets use the requested vertical separator',()=>{
 const creator=section('async function refreshCreatorReward','function clearTreasuryProof');
 assert.match(creator,/metadata\.quoteSymbol} ｜ \$\{metadata\.symbol}/);
 assert.doesNotMatch(creator,/metadata\.quoteSymbol} \/ \$\{metadata\.symbol}/);
});
