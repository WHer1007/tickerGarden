import {test} from 'node:test';
import assert from 'node:assert/strict';
import {FEATURED_STOCKS,sortStakingAssets,sortPairedAssets} from '../src/create/featured-stocks.ts';
import {pairedAssetsForChain} from '../src/create/paired-assets.ts';
import {STAKING_ASSETS} from '../src/create/staking-assets.ts';
import {readFileSync} from 'node:fs';
test('20 featured official stocks come first without changing membership or source order',()=>{
 const {assets}=JSON.parse(readFileSync(new URL('../src/create/generated/robinhood-mainnet-4663.staking-assets.json',import.meta.url),'utf8'));
 const original=assets.map((a:{symbol:string})=>a.symbol);
 const sorted=sortStakingAssets(assets,(a:{symbol:string})=>a.symbol).map(a=>a.symbol);
 assert.equal(new Set(FEATURED_STOCKS).size,20);
 assert.deepEqual(sorted.slice(0,20),[...FEATURED_STOCKS]);
 assert.deepEqual(sorted.slice(20),sorted.slice(20).sort((a,b)=>a.localeCompare(b,'en')));
 assert.deepEqual([...sorted].sort(),[...original].sort());
 assert.deepEqual(assets.map((a:{symbol:string})=>a.symbol),original);
});

test('BSC paired assets pin native/stables then ten RH featured companies, retaining identities and exclusions',()=>{
 const assets=pairedAssetsForChain(56),original=assets.map(a=>a.tokenAddress);
 const sorted=sortPairedAssets(assets),symbols=sorted.map(a=>a.symbol);
 assert.deepEqual(symbols.slice(0,13),['BNB','USDT','USDC','SPCXB','NVDAB','TSLAB','AAPLB','MSFTB','AMZNB','GOOGLB','METAB','AVGOB','AMDB']);
 assert.deepEqual(symbols.slice(13),symbols.slice(13).sort((a,b)=>a.localeCompare(b,'en')));
 assert.equal(symbols.includes('GPROB'),false);
 assert.equal(sorted.length,80);
 assert.deepEqual(sorted.map(a=>a.tokenAddress).sort(),[...original].sort());
 assert.deepEqual(assets.map(a=>a.tokenAddress),original);
 for(const asset of sorted)assert.ok(assets.includes(asset));
});

test('RH paired assets retain ETH/USDG and all twenty featured stocks',()=>{
 const sorted=sortPairedAssets(pairedAssetsForChain(4663));
 assert.deepEqual(sorted.slice(0,22).map(a=>a.symbol),['ETH','USDG',...FEATURED_STOCKS]);
});

test('BSC staking uses the paired stock order with an alphabetical tail and unchanged eligibility',()=>{
 const assets=STAKING_ASSETS.filter(a=>a.chainId===56&&a.enabled),original=assets.map(a=>a.assetUid);
 const sorted=sortStakingAssets(assets,a=>a.symbol,56),symbols=sorted.map(a=>a.symbol);
 const pairedStocks=sortPairedAssets(pairedAssetsForChain(56)).slice(3).map(a=>a.symbol);
 assert.deepEqual(symbols,pairedStocks);
 assert.deepEqual(symbols.slice(0,10),['SPCXB','NVDAB','TSLAB','AAPLB','MSFTB','AMZNB','GOOGLB','METAB','AVGOB','AMDB']);
 assert.deepEqual(symbols.slice(10),symbols.slice(10).sort((a,b)=>a.localeCompare(b,'en')));
 assert.equal(symbols.includes('GPROB'),false);
 assert.equal(sorted.length,77);
 assert.deepEqual(sorted.map(a=>a.assetUid).sort(),[...original].sort());
 assert.deepEqual(assets.map(a=>a.assetUid),original);
 for(const asset of sorted)assert.ok(assets.includes(asset));
});
