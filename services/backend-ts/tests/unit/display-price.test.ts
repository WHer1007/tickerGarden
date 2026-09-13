import assert from 'node:assert/strict';
import test from 'node:test';
import { f72PriceTargets, fetchPriceReferences, fetchTestnetPriceReferences, multiplyDecimal } from '../../packages/display-price/src/index.ts';
import { robinhoodTestnetStockRoutes } from '../../packages/display-price/src/testnet-routes.ts';
import { readDisplayPrices } from '../../packages/statistics-store/src/index.ts';
import type { Pool } from 'pg';
const fixture = { chainId: 46630 as const, token: `0x${'1'.repeat(40)}` as const, assetUid: `0x${'2'.repeat(64)}` as const, symbol: 'TSLA' };

test('display price applies the current multiplier exactly once and preserves decimal precision', async () => {
  const target=fixture;const now=new Date('2026-09-11T00:00:30.000Z');
  const responses:Record<string,unknown>={
    '/assets':{assets:[{id:target.assetUid,tokenSymbol:target.symbol,status:'ASSET_STATUS_ACTIVE',currentMultiplier:'0.125',pendingMultiplier:'',deployments:[{chainId:target.chainId,contractAddress:target.token}]}]},
    '/corporate-actions':{corpActions:[]},
    '/prices':{quotes:[{tokenSymbol:target.symbol,bid:'80',ask:'88',currency:'USD',isTradingHalt:false,generatedAt:'2026-09-11T00:00:00.000Z',deployments:[{chainId:target.chainId,contractAddress:target.token}]}]},
  };
  const fetcher:typeof fetch=async(input)=>new Response(JSON.stringify(responses[new URL(String(input)).pathname.replace('/rhj','')]),{status:200});
  const [reference]=await fetchPriceReferences([target],{fetcher,now,maxAgeSeconds:60});
  assert.equal(multiplyDecimal('80','0.125'),'10');assert.equal(reference?.bidUsd,'10');assert.equal(reference?.askUsd,'11');assert.equal(reference?.status,'available');
});

test('display price returns stale or unavailable records without publishing a usable value', async () => {
  const target=fixture;const now=new Date('2026-09-11T00:02:00.000Z');
  const fetcher:typeof fetch=async(input)=>{const path=new URL(String(input)).pathname;const body=path.endsWith('/assets')?{assets:[{id:target.assetUid,tokenSymbol:target.symbol,status:'ASSET_STATUS_ACTIVE',currentMultiplier:'1',pendingMultiplier:'',deployments:[{chainId:target.chainId,contractAddress:target.token}]}]}:path.endsWith('/corporate-actions')?{corpActions:[]}:{quotes:[{tokenSymbol:target.symbol,bid:'1',ask:'2',currency:'USD',isTradingHalt:false,generatedAt:'2026-09-11T00:00:00.000Z',deployments:[{chainId:target.chainId,contractAddress:target.token}]}]};return new Response(JSON.stringify(body),{status:200})};
  const [reference]=await fetchPriceReferences([target],{fetcher,now,maxAgeSeconds:60});assert.equal(reference?.status,'stale');assert.equal(reference?.bidUsd,null);assert.equal(reference?.askUsd,null);
});

test('testnet display prices bind the saved pool and combine its spot with native USD', async () => {
  const route=robinhoodTestnetStockRoutes[0];const target={...fixture,token:route.tokenOut,symbol:route.symbol};
  const word=(address:string)=>`0x${'0'.repeat(24)}${address.slice(2)}` as `0x${string}`;
  const slot0=`0x${(2n**96n).toString(16).padStart(64,'0')}${'0'.repeat(384)}` as `0x${string}`;
  const rpc={latestBlock:async()=>({number:123n}),callAt:async(_address:`0x${string}`,data:`0x${string}`)=>data==='0x0dfe1681'?word([route.tokenIn,route.tokenOut].sort()[0]!):data==='0xd21220a7'?word([route.tokenIn,route.tokenOut].sort()[1]!):slot0};
  const fetcher:typeof fetch=async()=>new Response(JSON.stringify({data:{base:'ETH',currency:'USD',amount:'2500'}}),{status:200});
  const references=await fetchTestnetPriceReferences([target],{rpc,fetcher,now:new Date('2026-09-11T00:00:00Z')});
  assert.deepEqual(references.map(item=>[item.symbol,item.source,item.status,item.bidUsd]),[
    ['ETH','coinbase_spot','available','2500'],[route.symbol,'testnet_pool_spot','available','2500'],
  ]);
});

test('testnet pool identity mismatch remains unavailable', async () => {
  const route=robinhoodTestnetStockRoutes[0];const target={...fixture,token:route.tokenOut,symbol:route.symbol};
  const rpc={latestBlock:async()=>({number:123n}),callAt:async()=>`0x${'0'.repeat(64)}` as `0x${string}`};
  const fetcher:typeof fetch=async()=>new Response(JSON.stringify({data:{base:'ETH',currency:'USD',amount:'2500'}}),{status:200});
  const references=await fetchTestnetPriceReferences([target],{rpc,fetcher,now:new Date('2026-09-11T00:00:00Z')});
  assert.equal(references[1]?.status,'unavailable');assert.equal(references[1]?.reason,'pool_identity_mismatch');
});

test('display catalog publishes the cached native reference with stock references', async () => {
  assert.deepEqual(f72PriceTargets(), []);
  const now=new Date('2026-09-11T00:00:00Z');const native={chainId:46630 as const,token:`0x${'0'.repeat(40)}` as const,assetUid:`0x${'0'.repeat(64)}` as const,symbol:'ETH',
    source:'coinbase_spot' as const,unit:'USD_PER_WHOLE_TOKEN' as const,status:'available' as const,bidUsd:'2500',askUsd:'2500',multiplier:'1',asOf:now.toISOString(),expiresAt:new Date(now.getTime()+600000).toISOString(),retrievedAt:now.toISOString()};
  const pool={query:async()=>({rows:[{asset:native.token,payload:native}]})} as unknown as Pool;
  const response=await readDisplayPrices({pool,deployment:{environment:'test',chainId:46630,deploymentDigest:`0x${'1'.repeat(64)}`,activationBlock:1n},now});
  assert.equal(response.references[0]?.symbol,'ETH');assert.equal(response.references[0]?.bidUsd,'2500');assert.equal(response.references.length,1);
});
