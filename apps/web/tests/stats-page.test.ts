import {controllerFunction} from './controller-source.ts';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import fs from 'node:fs';
import stats from '../src/pages/stats.ts';
test('Stats contains the requested metrics without old analytics sections',()=>{
 for(const label of ['24h volume','Token launches in 24h','Bloomed markets','Total staking value','Staking wallets','24h fee revenue','Staking value by Stock','Allocated in 24h'])assert.ok(stats.html.includes(label));
 for(const key of ['creator','staker','holder','platform'])assert.ok(stats.html.includes(`data-stat-fee-${key}`));
 assert.doesNotMatch(stats.html,/Current holder addresses|data-global-holders|data-global-series|Total Market Cap|data-stats-period|Holder Breakdown|Trading Breakdown/);
});
test('Stats summary uses the aggregate endpoint without paging the market directory',()=>{
 const source=fs.readFileSync(new URL('../src/app.ts',import.meta.url),'utf8');
 const sourceController=fs.readFileSync(new URL('../src/controllers/stats.ts',import.meta.url),'utf8');
 const body=sourceController.slice(sourceController.indexOf('async function renderStats('),sourceController.indexOf('function dispose('));
 assert.match(body,/renderProtocolStatistics/);assert.doesNotMatch(body,/appendMarketPage|refreshExploreStatistics|readContract/);
});
test('Stats price updates reuse the snapshot without refetching',()=>{
 const source=fs.readFileSync(new URL('../src/app.ts',import.meta.url),'utf8');
 const body=source.slice(source.indexOf('const unsubscribeAssetPrices'),source.indexOf('void restoreLaunchProgress',source.indexOf('const unsubscribeAssetPrices')));
 assert.match(body,/applyStatsSnapshot/);assert.doesNotMatch(body,/renderStats/);
});
test('Stats Stock list keeps failure state separate from a verified empty result',()=>{
 const source=fs.readFileSync(new URL('../src/ui/stats-stock-list.ts',import.meta.url),'utf8');
 assert.match(source,/failureMessage/);
 assert.match(source,/setUnavailable\(\)/);
 assert.match(source,/failureMessage = "-"/);
 assert.match(source,/failureMessage\?\?/);
 assert.match(source,/"No allocated Stock yet"/);
});
