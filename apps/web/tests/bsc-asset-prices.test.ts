import assert from 'node:assert/strict';
import {test} from 'node:test';
import fixture from './fixtures/bsc-price-references.json' with {type:'json'};
import {parseAssetPriceSnapshot,createAssetPriceStore} from '../src/v1/assetPrices.ts';
import {displayPriceView} from '../src/v1/displayPrices.ts';
const now=Date.parse('2026-11-12T16:53:12Z');
const stock=fixture.references.find(r=>r.symbol==='NVDAB')!;
test('actual BSC response keeps 81 identities and 80 available raw-token prices',()=>{
 const result=parseAssetPriceSnapshot(fixture,56,now);
 assert.equal(Object.keys(result.prices).length,81);
 assert.equal(Object.values(result.prices).filter(r=>r.status==='available').length,80);
 assert.equal(result.prices[stock.token]?.bidUsd,stock.bidUsd);
 assert.equal(Object.values(result.prices).find(r=>r.symbol==='GPROB')?.status,'unavailable');
 assert.match(displayPriceView(fixture,56,stock.token,now).text,/Binance/);
 const stable=fixture.references.find(r=>r.symbol==='USDT')!;
 assert.match(displayPriceView(fixture,56,stable.token,now).text,/USDT is valued at \$1/);
});
test('BSC refuses wrong identity, source, decimals, UI units and double-scaled prices',()=>{
 for(const change of [{chainId:4663},{token:'0x'+'1'.repeat(40)},{assetUid:'0x'+'2'.repeat(64)},{symbol:'TSLAB'},{source:'robinhood_rest'},{decimals:6},{valuationUnit:'BINANCE_UI'},{multiplier:'2'},{bidUsd:stock.uiBidUsd},{uiBidUsd:'1e3'}]){
  const response={...fixture,references:[{...stock,...change}]};assert.equal(Object.keys(parseAssetPriceSnapshot(response,56,now).prices).length,0,JSON.stringify(change));
 }
 const stable=fixture.references.find(r=>r.symbol==='USDT')!;
 for(const change of [{token:stock.token},{symbol:'USDG'},{bidUsd:'0.99'},{assetUid:stock.assetUid}])assert.equal(Object.keys(parseAssetPriceSnapshot({...fixture,references:[{...stable,...change}]},56,now).prices).length,0);
 assert.equal(Object.keys(parseAssetPriceSnapshot(fixture,4663,now).prices).length,0);
});
test('BSC expiration cannot supply a fresh USD value or survive failed refresh as available',async()=>{
 const parsed=parseAssetPriceSnapshot(fixture,56,now+60_000);assert.equal(parsed.prices[stock.token]?.status,'stale');assert.equal(parsed.prices[stock.token]?.midpointUsd,null);
 const store=createAssetPriceStore({chainId:56,baseUrl:'https://example.test',fetcher:async()=>Response.json(fixture)});
 try{await store.refresh();assert.equal(store.get(stock.token)?.status,'stale');assert.equal(store.midpointUsd(stock.token),null);}finally{store.stop();}
});
test('BSC view requests only its three paired assets and expiry sends no request',async()=>{
 let calls=0;const stable=fixture.references.find(r=>r.symbol==='USDT')!;
 const t=Date.now(),response={...fixture,references:[{...stable,asOf:new Date(t-1000).toISOString(),retrievedAt:new Date(t).toISOString(),expiresAt:new Date(t+150).toISOString()}]};
 const store=createAssetPriceStore({chainId:56,baseUrl:'https://example.test',fetcher:async(input)=>{
  calls++;const tokens=new URL(String(input)).searchParams.get('tokens')!.split(',');assert.equal(tokens.length,3);assert.ok(tokens.includes(stable.token));assert.ok(!tokens.includes(stock.token));return Response.json(response);
 }});
 try{await store.refresh();assert.equal(store.get(stable.token)?.status,'available');await new Promise(r=>setTimeout(r,200));assert.equal(store.snapshot().prices[stable.token]?.status,'stale');assert.equal(calls,1);}finally{store.stop();}
});
