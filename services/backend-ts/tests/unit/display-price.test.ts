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

async function stockReference(assetChanges:Record<string,unknown>={},quoteChanges:Record<string,unknown>={}) {
 const deployments=[{chainId:fixture.chainId,contractAddress:fixture.token}];
 const asset={id:fixture.assetUid,tokenSymbol:fixture.symbol,status:'ASSET_STATUS_ACTIVE',currentMultiplier:'1.000566080061092436',pendingMultiplier:'',deployments,...assetChanges};
 const quote={tokenSymbol:fixture.symbol,bid:'329.87',ask:'329.89',currency:'USD',isTradingHalt:false,generatedAt:'2026-09-15T12:00:00Z',deployments,...quoteChanges};
 const fetcher:typeof fetch=async input=>{
  const path=new URL(String(input)).pathname;
  // Historical/announced actions must not be an availability dependency.
  if(path.endsWith('/corporate-actions'))throw Error('announcement feed must not block a healthy quote');
  return Response.json(path.endsWith('/assets')?{assets:[asset]}:{quotes:[quote]});
 };
 return (await fetchPriceReferences([fixture],{fetcher,now:new Date('2026-09-15T12:00:10Z')}))[0]!;
}
test('Stock multiplier products retain up to 36 decimal places without invalidating healthy quotes',async()=>{
 const r=await stockReference();assert.equal(r.status,'available');assert.equal(r.bidUsd,'330.05673282975256186332');
 const tiny=await stockReference({currentMultiplier:'0.000000000000000001'},{bid:'0.000000000000000001',ask:'0.000000000000000002'});
 assert.equal(tiny.status,'available');assert.equal(tiny.bidUsd,'0.'+'0'.repeat(35)+'1');
});
test('action announcements and future multiplier schedules do not suppress current healthy prices',async()=>{
 assert.equal((await stockReference()).status,'available');
 const r=await stockReference({pendingMultiplier:'2',pendingMultiplierEffectiveTime:'2026-09-16T00:00:00Z'});
 assert.equal(r.status,'available');assert.equal(r.bidUsd,'330.05673282975256186332');
 const soon=await stockReference({pendingMultiplier:'2',pendingMultiplierEffectiveTime:'2026-09-15T12:00:20Z'});
 assert.equal(soon.expiresAt,'2026-09-15T12:00:20.000Z');
});
test('official inactive or halted assets and due or ambiguous multiplier transitions remain blocked',async()=>{
 for(const changes of [{status:'ASSET_STATUS_INACTIVE'},{pendingMultiplier:'2'},{pendingMultiplier:'2',pendingMultiplierEffectiveTime:'2026-09-15T12:00:10Z'},{pendingMultiplier:'2',pendingMultiplierEffectiveTime:'invalid'},{pendingMultiplier:'0',pendingMultiplierEffectiveTime:'2026-09-16T00:00:00Z'}])assert.equal((await stockReference(changes)).status,'unavailable');
 for(const changes of [{isTradingHalt:true},{bid:'0'},{bid:'400',ask:'399'},{currency:'EUR'},{bid:'1.'+'1'.repeat(19)}])assert.equal((await stockReference({},changes)).status,'unavailable');
});

test('one refresh publishes all prices in a single atomic database statement',async()=>{
 const {storePriceReferences}=await import('../../packages/display-price/src/index.ts');
 const calls:Array<{sql:string;values:unknown[]}>=[];
 const pool={query:async(sql:string,values:unknown[])=>{calls.push({sql,values});return {rows:[]};}};
 const now='2026-09-17T00:00:00.000Z';
 const references=Array.from({length:196},(_,i)=>({chainId:4663 as const,token:`0x${i.toString(16).padStart(40,'0')}` as `0x${string}`,assetUid:`0x${i.toString(16).padStart(64,'0')}` as `0x${string}`,symbol:`S${i}`,source:'robinhood_rest' as const,unit:'USD_PER_WHOLE_TOKEN' as const,status:'available' as const,bidUsd:'2',askUsd:'4',multiplier:'1',asOf:now,expiresAt:'2026-09-17T00:05:00.000Z',retrievedAt:now}));
 await storePriceReferences(pool as never,{environment:'production',chainId:4663,deploymentDigest:`0x${'a'.repeat(64)}`,activationBlock:1n},references);
 assert.equal(calls.length,1);assert.match(calls[0]!.sql,/jsonb_to_recordset/);
 const rows=JSON.parse(calls[0]!.values[3] as string);assert.equal(rows.length,196);
 assert.equal(rows[195].payload.token,references[195]!.token);assert.equal(Number(rows[0].value),3);
});
