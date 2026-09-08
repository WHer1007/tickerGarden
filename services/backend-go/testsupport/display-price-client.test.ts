import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TickerGardenV1Client, TickerGardenApiError, type DisplayPriceResponse } from '../openapi/generated/v1-client.ts';
test('display reference client preserves decimal strings and unavailable nulls',async()=>{
 const body:DisplayPriceResponse={chainId:4663,displayOnly:true,confidence:'provider_reported',status:'configured',references:[{chainId:4663,token:`0x${'1'.repeat(40)}`,assetUid:`0x${'2'.repeat(64)}`,symbol:'AAPL',source:'robinhood_rest',unit:'USD_PER_WHOLE_TOKEN',status:'stale',reason:'price_expired',bidUsd:null,askUsd:null,multiplier:'0.125000000000000000',asOf:'2026-09-06T12:00:00Z',expiresAt:'2026-09-06T12:01:00Z',retrievedAt:'2026-09-06T12:00:01Z'}]};
 const fetcher=(async(input,init)=>{assert.equal(String(input),'https://api.example/v1/prices/references');assert.equal(init?.method,'GET');return new Response(JSON.stringify(body));}) as typeof fetch;
 const result=await new TickerGardenV1Client('https://api.example',fetcher).listDisplayPriceReferences();assert.deepEqual(result,body);
});
test('display reference client preserves structured errors',async()=>{
 const client=new TickerGardenV1Client('https://api.example',(async()=>new Response(JSON.stringify({error:'invalid_query',message:'query unsupported',requestId:'r1'}),{status:400})) as typeof fetch);
 await assert.rejects(client.listDisplayPriceReferences(),(e:unknown)=>e instanceof TickerGardenApiError&&e.status===400&&e.body.error==='invalid_query');
});
