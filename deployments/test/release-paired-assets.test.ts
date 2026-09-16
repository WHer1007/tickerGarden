import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { assertReleasePairedAssets, assertReleaseAssetCoverage } from '../src/v1/release-paired-assets.ts';
const release=JSON.parse(readFileSync(new URL('../manifests/robinhood-mainnet-4663.paired-assets.json',import.meta.url),'utf8'));
const manifest=(pair:Record<string,unknown>,chainId=4663)=>({chain:{chainId},quoteAssets:[pair]});
const eth=release.assets.find((asset:{symbol:string})=>asset.symbol==='ETH');
const nvda=release.assets.find((asset:{symbol:string})=>asset.symbol==='NVDA');
test('release permits selected native/stock economics but rejects identity or units drift',()=>{
 assert.doesNotThrow(()=>assertReleasePairedAssets(manifest(eth)));
 assert.equal(eth.graduationThreshold, '3000000000000000000');
 assert.equal(eth.phantomQuote, '1200000000000000000');
 assert.throws(()=>assertReleasePairedAssets(manifest({...eth,phantomQuote:'1680000000000000000'})),/phantomQuote/);
 assert.throws(()=>assertReleasePairedAssets(manifest({...eth,graduationThreshold:'4200000000000000000'})),/graduationThreshold/);
 assert.throws(()=>assertReleasePairedAssets(manifest({...nvda,graduationThreshold:'1'})),/graduationThreshold/);
 assert.doesNotThrow(()=>assertReleasePairedAssets(manifest(nvda)));
 assert.throws(()=>assertReleasePairedAssets(manifest({...eth,graduationThreshold:'1'})),/graduationThreshold/);
 assert.throws(()=>assertReleasePairedAssets(manifest({...eth,decimals:6})),/decimals/);
 assert.throws(()=>assertReleasePairedAssets(manifest({...eth,tokenAddress:`0x${'1'.repeat(40)}`})),/outside/);
 assert.throws(()=>assertReleasePairedAssets(manifest(eth,46630)),/4663/);
});
test('production excludes cbBTC and WETH',()=>{
 assert.equal(release.assets.some((a:{symbol:string})=>['cbBTC','WETH'].includes(a.symbol)),false);
});

test('release evidence is complete and generator output has not drifted',async()=>{
 const {spawnSync}=await import('node:child_process');
 const result=spawnSync('python3',['tools/generate-v1-paired-assets.py','--check'],{cwd:new URL('../../',import.meta.url),encoding:'utf8'});
 assert.equal(result.status,0,result.stderr||result.stdout);
 assert.equal(release.assets.filter((a:{assetKind:string})=>a.assetKind==='OFFICIAL_STOCK').length,194);
 assert.equal(release.assets.filter((a:{activationStatus:string})=>a.activationStatus==='REGISTRY_ACTIVATION_REQUIRED').length,196);
 assert.equal(release.assets.filter((a:{activationStatus:string})=>a.activationStatus==='PARAMETERS_PENDING').length,0);
});

test('USDG uses approved 6-decimal economics and all approved quotes use exactly 40 percent reserves',()=>{
 const usdg=release.assets.find((a:{symbol:string})=>a.symbol==='USDG');
 assert.equal(usdg.graduationThreshold,'7000000000');
 assert.equal(usdg.phantomQuote,'2800000000');
 assert.doesNotThrow(()=>assertReleasePairedAssets(manifest(usdg)));
 assert.throws(()=>assertReleasePairedAssets(manifest({...usdg,phantomQuote:'3236000000',graduationThreshold:'8090000000'})),/mismatch/);
 for(const pair of release.assets){
  if(pair.graduationThreshold===null) assert.equal(pair.phantomQuote,null);
  else assert.equal(BigInt(pair.phantomQuote)*5n,BigInt(pair.graduationThreshold)*2n);
 }
});

test('194 Stock thresholds independently reproduce $7000 mid-price with one multiplier and half-up cents',async()=>{
 const snapshot=JSON.parse(readFileSync(new URL('../../docs/references/data/rh-all-stock-quote-thresholds-2026-09-12/thresholds.json',import.meta.url),'utf8'));
 const scaled=(s:string)=>{const [whole,fraction='']=s.split('.');assert.ok(fraction.length<=18);return BigInt(whole)*10n**18n+BigInt(fraction.padEnd(18,'0'));};
 assert.equal(snapshot.assets.length,194);
 for(const row of snapshot.assets){
  const denominator=(scaled(row.bid)+scaled(row.ask))*scaled(row.multiplier);
  const cents=(700000n*2n*10n**36n+denominator/2n)/denominator;
  const pair=release.assets.find((a:{tokenAddress:string})=>a.tokenAddress===row.tokenAddress);
  assert.equal(BigInt(pair.graduationThreshold),cents*10n**BigInt(pair.decimals)/100n,row.symbol);
  assert.equal(BigInt(pair.phantomQuote)*5n,BigInt(pair.graduationThreshold)*2n,row.symbol);
  assert.match(row.graduationThresholdTokens,/^\d+\.\d{2}$/);
  assert.doesNotThrow(()=>assertReleasePairedAssets(manifest(pair)));
 }
 const {spawnSync}=await import('node:child_process');
 const result=spawnSync('python3',['tools/research/build-all-stock-quote-thresholds.py','--check'],{cwd:new URL('../../',import.meta.url),encoding:'utf8'});
 assert.equal(result.status,0,result.stderr||result.stdout);
});

test('production coverage rejects missing assets, duplicates and wrong stake minimum',()=>{
 const stocks=JSON.parse(readFileSync(new URL('../manifests/robinhood-mainnet-4663.staking-assets.json',import.meta.url),'utf8'));
 const candidate={chain:{chainId:4663},quoteAssets:release.assets,officialStocks:stocks.assets};
 assert.doesNotThrow(()=>assertReleaseAssetCoverage(candidate));
 assert.throws(()=>assertReleaseAssetCoverage({...candidate,quoteAssets:release.assets.slice(1)}),/196/);
 assert.throws(()=>assertReleaseAssetCoverage({...candidate,officialStocks:stocks.assets.slice(1)}),/194/);
 assert.throws(()=>assertReleaseAssetCoverage({...candidate,officialStocks:stocks.assets.map((a:object,i:number)=>i? a: {...a,minimumAllocation:'1'})}),/0.5/);
 assert.throws(()=>assertReleaseAssetCoverage({...candidate,officialStocks:[...stocks.assets.slice(1),stocks.assets[1]]}),/194/);
});
