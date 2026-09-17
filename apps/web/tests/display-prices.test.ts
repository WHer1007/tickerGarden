import assert from 'node:assert/strict';
import { test } from 'node:test';
import { displayPriceView, mountDisplayPrice } from '../src/v1/displayPrices.ts';
import { createAssetPriceStore, parseAssetPriceSnapshot } from '../src/v1/assetPrices.ts';
const token = `0x${'1'.repeat(40)}`;
const now = Date.parse('2026-09-06T12:00:00Z');
function fixture(time = now, address = token) { return {chainId:4663,displayOnly:true,confidence:'provider_reported',status:'configured',references:[{chainId:4663,token:address,assetUid:`0x${'2'.repeat(64)}`,symbol:'AAPL',source:'robinhood_rest',unit:'USD_PER_WHOLE_TOKEN',status:'available',bidUsd:'26.681250',askUsd:'26.683750',multiplier:'0.125',asOf:new Date(time-1000).toISOString(),expiresAt:new Date(time+59000).toISOString(),retrievedAt:new Date(time).toISOString()}]}; }
test('display uses token prices once and preserves arbitrary precision',()=>{
 const data=fixture();const view=displayPriceView(data,4663,token,now);assert.equal(view.status,'available');assert.match(view.text,/\$26\.68125–\$26\.68375 per AAPL token/);assert.match(view.text,/Robinhood/);assert.match(view.text,/Display estimate only/);
 data.references[0]!.bidUsd='9007199254740993.000000000000000001';data.references[0]!.askUsd='9007199254740994.000000000000000001';assert.match(displayPriceView(data,4663,token,now).text,/9007199254740993\.000000000000000001/);
});
test('response identity, precision and freshness fail closed',()=>{
 const mutations:((d:ReturnType<typeof fixture>)=>void)[]=[d=>{d.chainId=46630},d=>{d.displayOnly=false},d=>{d.confidence='verified'},d=>{d.references.push(d.references[0]!)},d=>{d.references[0]!.token=`0x${'3'.repeat(40)}`},d=>{d.references[0]!.chainId=1},d=>{d.references[0]!.source='chainlink'},d=>{d.references[0]!.symbol='<img>'},d=>{d.references[0]!.bidUsd='1e4'},d=>{d.references[0]!.bidUsd='0'},d=>{d.references[0]!.askUsd='1'},d=>{d.references[0]!.asOf='invalid'},d=>{d.references[0]!.asOf=new Date(now+1).toISOString()},d=>{d.references[0]!.expiresAt=new Date(now+3600000).toISOString()},d=>{d.references[0]!.retrievedAt=new Date(now+6000).toISOString()}];
 for(const change of mutations){const data=fixture();change(data);const view=displayPriceView(data,4663,token,now);assert.equal(view.status,'unavailable');assert.doesNotMatch(view.text,/26\.68/)}
 for(const payload of [null,{},[],{...fixture(),references:null},{...fixture(),references:[null]}]) assert.equal(displayPriceView(payload,4663,token,now).status,'unavailable');
 assert.equal(displayPriceView(fixture(),4663,token,now+59000).status,'stale');
});
test('one global catalog request updates every subscribed price consumer',async()=>{
 const other=`0x${'4'.repeat(40)}`;const data=fixture(Date.now());data.references.push({...data.references[0]!,token:other,symbol:'AMD'});
 let calls=0;const store=createAssetPriceStore({baseUrl:'https://api.example',chainId:4663,fetcher:async()=>{calls++;return new Response(JSON.stringify(data));}});
 const first={textContent:'',dataset:{}} as unknown as HTMLElement,second={textContent:'',dataset:{}} as unknown as HTMLElement;
 const a=mountDisplayPrice(first,store,4663),b=mountDisplayPrice(second,store,4663);a.setToken(token);b.setToken(other);
 await store.refresh();assert.equal(calls,1);assert.match(first.textContent??'',/26\.68125/);assert.match(second.textContent??'',/AMD token/);
 a.stop();b.stop();store.stop();
});
test('full catalog of 196 references remains readable and oversized responses are rejected',()=>{
 const data=fixture();
 const template=data.references[0]!;
 data.references=Array.from({length:196},(_,i)=>({...template,token:`0x${(i+1).toString(16).padStart(40,'0')}`}));
 const selected=data.references[195]!.token;
 assert.equal(displayPriceView(data,4663,selected,now).status,'available');
 data.references=Array.from({length:257},(_,i)=>({...template,token:`0x${(i+1).toString(16).padStart(40,'0')}`}));
 assert.equal(displayPriceView(data,4663,selected,now).status,'unavailable');
});


test('global store publishes changed prices and keeps an unexpired value across a failed refresh',async()=>{
 let response=fixture(Date.now()),fail=false,calls=0;
 const store=createAssetPriceStore({baseUrl:'https://api.example',chainId:4663,fetcher:async(_input,init)=>{calls++;assert.equal(init?.cache,undefined);if(fail)throw Error('offline');return new Response(JSON.stringify(response));}});
 const element={textContent:'',dataset:{}} as unknown as HTMLElement;
 const widget=mountDisplayPrice(element,store,4663);widget.setToken(token);await store.refresh();assert.match(element.textContent??'',/26\.68125/);
 response=fixture(Date.now());response.references[0]!.bidUsd='99';response.references[0]!.askUsd='100';await store.refresh();assert.match(element.textContent??'',/\$99–\$100/);
 fail=true;await store.refresh();assert.equal(calls,3);assert.match(element.textContent??'',/\$99–\$100/);
 widget.stop();store.stop();
});

test('global snapshot exposes midpoint values without binary floating point',()=>{
 const data=fixture();data.references[0]!.bidUsd='9007199254740993.000000000000000001';data.references[0]!.askUsd='9007199254740994.000000000000000001';
 assert.equal(parseAssetPriceSnapshot(data,4663,now).prices[token]?.midpointUsd,'9007199254740993.500000000000000001');
});

test('USDG fixed valuation is labeled as an assumption and rejects non-dollar fixed values',()=>{
 const data=fixture();data.references=[{...data.references[0]!,symbol:'USDG',source:'fixed_usd',bidUsd:'1',askUsd:'1',multiplier:'1'}];
 const view=displayPriceView(data,4663,token,now);assert.equal(view.status,'available');assert.match(view.text,/fixed assumption/);assert.doesNotMatch(view.text,/Coinbase/);
 data.references[0]!.bidUsd='0.99';assert.equal(displayPriceView(data,4663,token,now).status,'unavailable');
});
