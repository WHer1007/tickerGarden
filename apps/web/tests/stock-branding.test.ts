import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {stockBrandLogoUrl,stockDisplaySymbol} from '../src/create/stock-branding.ts';
import {bscStakingAssets} from '../src/chains/bsc/generated.ts';
import {STAKING_ASSETS} from '../src/create/staking-assets.ts';
import {pairedAssetsForChain} from '../src/create/paired-assets.ts';
import rh from '../src/create/generated/robinhood-mainnet-4663.paired-assets.json' with {type:'json'};
import sources from '../assets/company-logo-sources.json' with {type:'json'};

test('both BSC pickers reuse the exact RH company image without changing asset identities',()=>{
 for(const asset of bscStakingAssets){
  const stock=STAKING_ASSETS.find(a=>a.chainId===56&&a.assetUid===asset.assetUid)!;
  assert.equal(stock.tokenAddress,asset.tokenAddress);
  assert.equal(stock.symbol,asset.symbol);
  assert.equal(stock.logo,''); // Do not let a legacy quote SVG override the shared RH image.
  const shared=rh.assets.find(a=>a.symbol===stockDisplaySymbol(asset.symbol));
  if(shared?.logoUrl)assert.equal(stock.logoUrl,shared.logoUrl);
  assert.equal(stock.logoUrl,stockBrandLogoUrl(asset.symbol));
  const bytes=readFileSync(new URL(`../public${stock.logoUrl}`,import.meta.url));
  assert.equal(bytes.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
  if(stock.enabled)assert.equal(pairedAssetsForChain(56).find(a=>a.symbol===stock.symbol)?.logoUrl,stock.logoUrl);
 }
});

test('display aliases are limited to registered bStocks, not arbitrary B suffixes',()=>{
 assert.equal(stockDisplaySymbol('NVDAB'),'NVDA');
 assert.equal(stockDisplaySymbol('nvDAb'),'NVDA');
 assert.equal(stockDisplaySymbol('BABAB'),'BABA');
 assert.equal(stockDisplaySymbol('BABA'),'BABA');
 assert.equal(stockDisplaySymbol('BB'),'BB');
 assert.equal(stockDisplaySymbol('UNKNOWNB'),'UNKNOWNB');
 assert.equal(stockBrandLogoUrl('UNKNOWNB'),undefined);
});

test('supplemental logos are local, nonempty original PNGs with pinned source hashes',()=>{
 for(const entry of sources.assets){
  assert.equal(stockBrandLogoUrl(entry.symbol),entry.path);
  assert.match(entry.source,/^https:\/\//);
  assert.match(entry.path,/^\/company-logos\/[a-z0-9]+\.png$/);
  const bytes=readFileSync(new URL(`../public${entry.path}`,import.meta.url));
  assert.equal(bytes.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
  assert.equal(createHash('sha256').update(bytes).digest('hex'),entry.sha256);
 }
 for(const symbol of ['USDT','USDC'])assert.ok(stockBrandLogoUrl(symbol));
});
