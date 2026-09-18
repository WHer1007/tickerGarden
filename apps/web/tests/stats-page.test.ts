import assert from 'node:assert/strict';
import {test} from 'node:test';
import fs from 'node:fs';
import stats from '../src/pages/stats.ts';
test('Stats contains the requested metrics without old analytics sections',()=>{
 for(const label of ['24h volume','Token launches in 24h','Bloomed markets','Total staking value','Staking wallets','24h fee revenue','Staking value by Stock','Allocated in 24h'])assert.ok(stats.html.includes(label));
 for(const key of ['creator','staker','holder','platform'])assert.ok(stats.html.includes(`data-stat-fee-${key}`));
 assert.doesNotMatch(stats.html,/Current holder addresses|data-global-holders|data-global-series|Total Market Cap|data-stats-period|Holder Breakdown|Trading Breakdown/);
});
test('Stock stats full list exposes quantity detail and a full-page zero allocation toggle',()=>{
 const source=fs.readFileSync(new URL('../src/ui/stats-stock-list.ts',import.meta.url),'utf8');
 const page=fs.readFileSync(new URL('../src/pages/statsStocks.ts',import.meta.url),'utf8');
 assert.match(source,/options\.full/);assert.match(source,/Hide zero allocations/);assert.match(source,/Search Stock name or symbol/);assert.match(source,/No Stock matches found/);assert.match(source,/Allocated:/);assert.match(source,/Exact USD value/);
 assert.match(page,/stats-stocks-page/);assert.doesNotMatch(fs.readFileSync(new URL('../src/pages/stats.ts',import.meta.url),'utf8'),/Hide zero allocations/);
});
test('Stats reads only the DB display endpoint without market or RPC reads',()=>{
 const sourceController=fs.readFileSync(new URL('../src/controllers/stats.ts',import.meta.url),'utf8');
 assert.match(sourceController,/\/v1\/stats\/display/);assert.doesNotMatch(sourceController,/protocol-statistics|assetPrices|readContract|appendMarketPage|refreshExploreStatistics/);
});
test('Stats retains its displayed snapshot when refreshes fail or navigation changes',()=>{
 const sourceController=fs.readFileSync(new URL('../src/controllers/stats.ts',import.meta.url),'utf8');
 const sourceUpdates=fs.readFileSync(new URL('../src/v1/statsUpdates.ts',import.meta.url),'utf8');
 assert.match(sourceUpdates,/store\.apply\(raw,section\)/);assert.match(sourceUpdates,/Retain the last valid section on errors and aborts/);
 assert.match(sourceUpdates,/controller\.abort\(\)/);assert.doesNotMatch(sourceController,/statsSnapshot=null/);
});
test('Stats reattaches visibility recovery on each mount and limits refreshes to the active Stats page',()=>{
 const source=fs.readFileSync(new URL('../src/controllers/stats.ts',import.meta.url),'utf8');
 const setup=source.slice(source.indexOf('function setupStats()'),source.indexOf('function applyStatsSnapshot()'));
 const visibility=source.slice(source.indexOf('function onVisibility()'),source.indexOf('function dispose()'));
 assert.match(setup,/removeEventListener\('visibilitychange',onVisibility\)/);assert.match(setup,/addEventListener\('visibilitychange',onVisibility\)/);
 assert.match(visibility,/!\['stats','statsStocks'\]\.includes\(ctx\.currentPage\(\)\)/);assert.match(source,/getSections:sectionsForPage/);
});
test('Stats no longer revalues its materialized USD snapshot from browser prices',()=>{
 const source=fs.readFileSync(new URL('../src/app.ts',import.meta.url),'utf8');
 const body=source.slice(source.indexOf('const unsubscribeAssetPrices'),source.indexOf('void restoreLaunchProgress',source.indexOf('const unsubscribeAssetPrices')));
 assert.doesNotMatch(body,/applyStatsSnapshot/);
});
test('Stats Stock list keeps failure state separate from a verified empty result',()=>{
 const source=fs.readFileSync(new URL('../src/ui/stats-stock-list.ts',import.meta.url),'utf8');
 assert.match(source,/failureMessage/);
 assert.match(source,/setUnavailable\(\)/);
 assert.match(source,/failureMessage = "-"/);
 assert.match(source,/failureMessage\?\?/);
 assert.match(source,/"No allocated Stock yet"/);
});
