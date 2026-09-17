import test from 'node:test';
import {execFileSync} from 'node:child_process';
test('mainnet display catalog publishes the cached fixed USDG once through both price APIs',()=>{
 const code=`import assert from 'node:assert/strict';
 import {runtimeConfigs} from './packages/runtime-deployment/src/index.ts';
 import {readDisplayPrices,readStatisticsPrices} from './packages/statistics-store/src/index.ts';
 const quote=runtimeConfigs.find(c=>c.kind==='quote'&&c.values.symbol==='USDG');assert.ok(quote);
 const now=new Date('2026-09-18T00:00:00Z');const token=quote.values.quoteAsset.toLowerCase();
 const usdg={chainId:4663,token,assetUid:quote.id,symbol:'USDG',source:'fixed_usd',unit:'USD_PER_WHOLE_TOKEN',status:'available',bidUsd:'1',askUsd:'1',multiplier:'1',asOf:now.toISOString(),expiresAt:new Date(now.getTime()+300000).toISOString(),retrievedAt:now.toISOString()};
 const input={pool:{query:async()=>({rows:[{asset:token,payload:usdg}]})},deployment:{environment:'production',chainId:4663,deploymentDigest:'0x'+'1'.repeat(64),activationBlock:1n},now};
 const result=await readDisplayPrices(input);const found=result.references.filter(r=>r.token===token);assert.equal(found.length,1);assert.equal(found[0].source,'fixed_usd');assert.equal(found[0].bidUsd,'1');
 assert.equal((await readStatisticsPrices(input)).prices[token],'1.000000000000000000');
 const missing=await readDisplayPrices({...input,pool:{query:async()=>({rows:[]})}});assert.equal(missing.references.find(r=>r.token===token).bidUsd,null);`;
 execFileSync(process.execPath,['--experimental-strip-types','--input-type=module','-e',code],{env:{...process.env,TG_ENVIRONMENT:'production',TG_CHAIN_ID:'4663',VERCEL_ENV:'production'},stdio:'pipe'});
});
