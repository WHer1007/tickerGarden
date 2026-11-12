import test from 'node:test';import assert from 'node:assert/strict';
import {CURRENT_CHAIN_ID} from '../../packages/runtime-deployment/src/index.ts';
import {fetchRuntimePriceReferences,f72PriceTargets,runtimePriceTargets,requestedPriceTokens} from '../../packages/display-price/src/index.ts';
import {createRequestedPriceRefresh} from '../../apps/read-api/src/requested-prices.ts';
test('selected mainnet currencies and one stock fetch no unrequested quotes and never use RPC',{skip:CURRENT_CHAIN_ID!==4663},async()=>{
 const calls:string[]=[],now=new Date(),stock=f72PriceTargets()[0]!;
 const fetcher:typeof fetch=async(input)=>{const url=String(input);calls.push(url);return Response.json(url.includes('coinbase')?{data:{base:'ETH',currency:'USD',amount:'2000'}}:url.endsWith('/assets')?{assets:[{id:stock.assetUid,tokenSymbol:stock.symbol,status:'ASSET_STATUS_ACTIVE',currentMultiplier:'1',pendingMultiplier:'',deployments:[{chainId:4663,contractAddress:stock.token}]}]}:{quotes:[{tokenSymbol:stock.symbol,currency:'USD',isTradingHalt:false,bid:'10',ask:'11',generatedAt:now.toISOString(),deployments:[{chainId:4663,contractAddress:stock.token}]}]});};
 const rpc={latestBlock:async()=>{throw Error('unexpected RPC');},callAt:async()=>{throw Error('unexpected RPC');}};
 const stable=runtimePriceTargets().find(t=>t.symbol==='USDG')!;
 let refs=await fetchRuntimePriceReferences([],{rpc,fetcher,now,tokens:[stable.token]});assert.equal(refs.length,1);assert.equal(refs[0]!.status,'available');assert.equal(calls.length,0);
 refs=await fetchRuntimePriceReferences([],{rpc,fetcher,now,tokens:['0x'+'0'.repeat(40)]});assert.equal(refs.length,1);assert.equal(calls.length,1);assert.equal(refs[0]!.symbol,'ETH');
 calls.length=0;refs=await fetchRuntimePriceReferences([stock],{rpc,fetcher,now,tokens:[stock.token]});assert.equal(refs.length,1);assert.equal(refs[0]!.status,'available');assert.equal(calls.length,2);assert.ok(calls.every(x=>x.includes('robinhood')));
 assert.throws(()=>requestedPriceTokens(['0x'+'f'.repeat(40)]));assert.throws(()=>requestedPriceTokens([stock.token,stock.token]));
});
test('identical active price requests coalesce while different assets retain separate cache identities',async()=>{
 let calls=0;const refresh=createRequestedPriceRefresh({TG_ENVIRONMENT:'production',TG_REQUESTED_PRICE_ORIGIN:'https://internal.example',TG_REQUESTED_PRICE_TOKEN:'fixture'},async()=>{calls++;await new Promise(r=>setTimeout(r,5));return Response.json({});});
 await Promise.all([refresh('one',['a']),refresh('two',['a'])]);assert.equal(calls,1);await refresh('cached',['a']);assert.equal(calls,1);await refresh('different',['b']);assert.equal(calls,2);
});
