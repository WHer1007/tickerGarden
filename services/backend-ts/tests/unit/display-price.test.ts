import assert from 'node:assert/strict';
import test from 'node:test';
import { f72PriceTargets, fetchPriceReferences, multiplyDecimal } from '../../packages/display-price/src/index.ts';

test('display price applies the current multiplier exactly once and preserves decimal precision', async () => {
  const target=f72PriceTargets()[0]!;const now=new Date('2026-09-11T00:00:30.000Z');
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
  const target=f72PriceTargets()[0]!;const now=new Date('2026-09-11T00:02:00.000Z');
  const fetcher:typeof fetch=async(input)=>{const path=new URL(String(input)).pathname;const body=path.endsWith('/assets')?{assets:[{id:target.assetUid,tokenSymbol:target.symbol,status:'ASSET_STATUS_ACTIVE',currentMultiplier:'1',pendingMultiplier:'',deployments:[{chainId:target.chainId,contractAddress:target.token}]}]}:path.endsWith('/corporate-actions')?{corpActions:[]}:{quotes:[{tokenSymbol:target.symbol,bid:'1',ask:'2',currency:'USD',isTradingHalt:false,generatedAt:'2026-09-11T00:00:00.000Z',deployments:[{chainId:target.chainId,contractAddress:target.token}]}]};return new Response(JSON.stringify(body),{status:200})};
  const [reference]=await fetchPriceReferences([target],{fetcher,now,maxAgeSeconds:60});assert.equal(reference?.status,'stale');assert.equal(reference?.bidUsd,null);assert.equal(reference?.askUsd,null);
});
