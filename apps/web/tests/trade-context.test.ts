import {controllerSources} from './controller-source.ts';
import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {tradeContextKey} from '../src/v1/tradeContext.ts';
import type {MarketReadModel} from '../src/v1/generated/read-api.ts';
const market={marketId:'one',memeToken:'meme',quoteAsset:'quote',sourceVersion:1,launchPhase:0,canonicalRoute:{router:'r',poolTradingEnabled:false},poolKey:null,poolId:null} as unknown as MarketReadModel;
test('unrelated publication data preserves quotes while execution binding changes invalidate them',()=>{
 const key=tradeContextKey(market);
 assert.equal(tradeContextKey({...market,display:{priceQuote:'2'} as MarketReadModel['display'],source:{blockNumber:'20'} as MarketReadModel['source']}),key);
 for(const next of [{...market,launchPhase:1 as const},{...market,sourceVersion:2},{...market,poolId:'0xab' as const},{...market,canonicalRoute:{...market.canonicalRoute,router:'0xab' as const}},{...market,quoteAsset:'0xab' as const}])assert.notEqual(tradeContextKey(next),key);
});
test('background display invalidation retains quote state; submission still checks canonical route',()=>{
 const app=readFileSync(new URL('../src/app.ts',import.meta.url),'utf8')+'\n'+controllerSources.slice(0,2).join('\n');
 const invalidation=app.slice(app.indexOf('function invalidateSnapshotReads('),app.indexOf('function startSnapshotUpdates()'));
 const guarded=invalidation.slice(invalidation.indexOf('if(!preserveTradeDisplay){'),invalidation.indexOf('  ++launchPreviewGeneration'));
 for(const field of ['verifiedMarketReleases.clear()','verifiedMarketRuntime.clear()','tradeQuote=null','++tradeQuoteGeneration'])assert.ok(guarded.includes(field));
 assert.match(app,/verifyChain: \(\) => ensureCanonicalMarket\(market.market\)/);
 assert.match(app,/quote.expiresAtMs <= Date.now\(\)/);
});
