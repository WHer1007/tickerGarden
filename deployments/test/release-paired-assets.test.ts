import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { assertReleasePairedAssets } from '../src/v1/release-paired-assets.ts';
const release=JSON.parse(readFileSync(new URL('../manifests/robinhood-mainnet-4663.paired-assets.json',import.meta.url),'utf8'));
const manifest=(pair:Record<string,unknown>,chainId=4663)=>({chain:{chainId},quoteAssets:[pair]});
const eth=release.assets.find((asset:{symbol:string})=>asset.symbol==='ETH');
const nvda=release.assets.find((asset:{symbol:string})=>asset.symbol==='NVDA');
test('release permits selected native/stock economics but rejects identity or units drift',()=>{
 assert.doesNotThrow(()=>assertReleasePairedAssets(manifest(eth)));
 assert.doesNotThrow(()=>assertReleasePairedAssets(manifest(nvda)));
 assert.throws(()=>assertReleasePairedAssets(manifest({...nvda,assetUid:eth.tokenAddress})),/assetUid/);
 assert.throws(()=>assertReleasePairedAssets(manifest({...eth,graduationThreshold:'1'})),/graduationThreshold/);
 assert.throws(()=>assertReleasePairedAssets(manifest({...eth,decimals:6})),/decimals/);
 assert.throws(()=>assertReleasePairedAssets(manifest({...eth,tokenAddress:`0x${'1'.repeat(40)}`})),/outside/);
 assert.throws(()=>assertReleasePairedAssets(manifest(eth,46630)),/4663/);
});
test('administrator-reviewed USDG and cbBTC are release-eligible',()=>{
 for(const symbol of ['USDG','cbBTC']) assert.doesNotThrow(()=>assertReleasePairedAssets(manifest(release.assets.find((a:{symbol:string})=>a.symbol===symbol))));
});

test('release evidence is complete and generator output has not drifted',async()=>{
 const {spawnSync}=await import('node:child_process');
 const result=spawnSync('python3',['tools/generate-v1-paired-assets.py','--check'],{cwd:new URL('../../',import.meta.url),encoding:'utf8'});
 assert.equal(result.status,0,result.stderr||result.stdout);
 assert.equal(release.assets.filter((a:{assetKind:string})=>a.assetKind==='OFFICIAL_STOCK').length,53);
 assert.equal(release.assets.filter((a:{activationStatus:string})=>a.activationStatus==='REGISTRY_ACTIVATION_REQUIRED').length,56);
});
