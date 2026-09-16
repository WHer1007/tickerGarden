import test from 'node:test';
import assert from 'node:assert/strict';
import {encodeAbiParameters,encodeEventTopics,type Hex} from 'viem';
import {v1Abis} from '../src/v1/generated/abis.ts';
import {sumAllocatedFees,explorerFeeDistribution,explorerStakeStatistics} from '../src/v1/stakeStatistics.ts';
import type {MarketReadModel} from '../src/v1/generated/read-api.ts';
const marketId=`0x${'1'.repeat(64)}` as Hex,quote=`0x${'2'.repeat(40)}` as Hex,meme=`0x${'3'.repeat(40)}` as Hex;
function event(name:string,args:Record<string,unknown>){
 const abi=v1Abis.ProtocolFeeVault.find(item=>item.type==='event'&&item.name===name)!;
 if(abi.type!=='event')throw Error('Missing event');
 const inputs=abi.inputs.filter(input=>!input.indexed);
 return {topics:encodeEventTopics({abi:[abi],eventName:name,args} as any) as Hex[],data:encodeAbiParameters(inputs,inputs.map(input=>args[input.name]) as any)};
}
test('cumulative credits include holder allocations once and keep assets separate',()=>{
 const logs=[
 event('CurveFeesSwept',{marketId,creatorEpoch:1,quoteAsset:quote,sweepNonce:1n,feeId:marketId,amount:100n,creatorAmount:20n,platformAmount:70n}),
 event('HolderFeesAccrued',{marketId,epochId:1,feeAsset:quote,amount:10n}),
 event('FeeBucketsCredited',{marketId,creatorEpoch:1,feeAsset:meme,feeId:marketId,creatorAmount:4n,stakerAmount:6n,platformAmount:10n,activeStock:100n})];
 assert.deepEqual([...sumAllocatedFees(logs,marketId)],[[quote,100n],[meme,20n]]);
 assert.throws(()=>sumAllocatedFees(logs,`0x${'4'.repeat(64)}`),'wrong market');
});
test('display statistics validates scope, freshness and fee coverage',async()=>{
 const original=globalThis.fetch;let calls=0;
 globalThis.fetch=async()=>{calls++;return new Response(JSON.stringify({chainId:46630,displayOnly:true,marketId,observedAt:Math.floor(Date.now()/1000),feeCoverage:true,volumeRaw:'12',volumeAt:Math.floor(Date.now()/1000),feeDistribution:[{recipient:'creator',asset:meme,amountRaw:'4'},{recipient:'stakers',asset:meme,amountRaw:'6'}]}));};
 const market={marketId,curve:meme,launchPhase:0,source:{blockNumber:'456'}} as MarketReadModel;
 const context={chainId:46630,apiBase:'https://distribution.test',market,decimals:18,feeVault:quote};
 try{const a=await explorerStakeStatistics(context);assert.equal(a.volume,'0.000000000000000012');assert.deepEqual([...a.fees!],[[meme,10n]]);assert.equal(calls,1);assert.deepEqual((await explorerFeeDistribution(context)).map(x=>[x.recipient,x.amountRaw]),[['creator','4'],['stakers','6']]);assert.equal(calls,1);await assert.rejects(explorerStakeStatistics({...context,market:{...market,marketId:`0x${'4'.repeat(64)}`} as MarketReadModel}),/Invalid/);}finally{globalThis.fetch=original;}
});
test('fee coverage false withholds incomplete fees and null volume stays unavailable',async()=>{
 const original=globalThis.fetch;const urls:URL[]=[];let truncated=false;
 globalThis.fetch=async(input)=>{urls.push(new URL(String(input)));return new Response(JSON.stringify({chainId:46630,displayOnly:true,marketId,observedAt:Math.floor(Date.now()/1000),feeCoverage:false,volumeRaw:null,volumeAt:Math.floor(Date.now()/1000),feeDistribution:[{recipient:'creator',asset:meme,amountRaw:'9'}]}));};
 const market={marketId,curve:meme,launchPhase:0,source:{blockNumber:'123'}} as MarketReadModel;
 const context={chainId:46630,apiBase:'https://statistics.test',market,decimals:18,feeVault:quote};
 try{
  const a=await explorerStakeStatistics({...context,apiBase:'https://incomplete.test'});assert.equal(a.volume,'');assert.equal(a.fees,null);assert.equal(urls.length,1);
 }finally{globalThis.fetch=original;}
});

test('rolling volume expires while cumulative finalized fee allocations remain visible',async()=>{
 const original=globalThis.fetch;let count=0;const now=Math.floor(Date.now()/1000);
 const market={marketId} as MarketReadModel;
 const base={chainId:46630,displayOnly:true,marketId,feeCoverage:true,feeDistribution:[{recipient:'holders',asset:meme,amountRaw:'7'}]};
 const context={chainId:46630,apiBase:'https://independent.test',market,decimals:18,feeVault:quote};
 try{
  globalThis.fetch=async()=>{count++;await new Promise(r=>setTimeout(r,5));return new Response(JSON.stringify({...base,observedAt:now,volumeAt:0,volumeRaw:null}));};
  const [a,b]=await Promise.all([explorerStakeStatistics(context),explorerStakeStatistics(context)]);
  assert.equal(count,1);assert.equal(a.volume,'');assert.equal(a.fees?.get(meme),7n);assert.deepEqual(a,b);
  globalThis.fetch=async()=>new Response(JSON.stringify({...base,observedAt:now-1300,volumeAt:now,volumeRaw:'1000000000000000000'}));
  const c=await explorerStakeStatistics({...context,apiBase:'https://oldfees.test'});assert.equal(c.volume,'1');assert.equal(c.fees?.get(meme),7n);
 }finally{globalThis.fetch=original;}
});

 test('mainnet statistics validate chain identity and do not reuse testnet cache', async () => {
  const original = globalThis.fetch;
  const now = Math.floor(Date.now() / 1000);
  const context = {chainId:4663, apiBase:'https://mainnet-isolation.test', market:{marketId} as MarketReadModel, decimals:18, feeVault:quote};
  let calls = 0;
  globalThis.fetch = async () => { calls++; return new Response(JSON.stringify({chainId:4663,displayOnly:true,marketId,observedAt:now,volumeAt:now,feeCoverage:true,volumeRaw:'1000000000000000000',feeDistribution:[]})); };
  try {
    assert.equal((await explorerStakeStatistics(context)).volume, '1');
    await assert.rejects(explorerStakeStatistics({...context, chainId:46630}), /Invalid/);
    assert.equal(calls, 2);
  } finally { globalThis.fetch = original; }
});
