import assert from 'node:assert/strict';
import { test } from 'node:test';
import { displayPriceView, mountDisplayPrice } from '../src/v1/displayPrices.ts';
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
 for(const payload of [null,{},[],{...fixture(),references:null}]) assert.equal(displayPriceView(payload,4663,token,now).status,'unavailable');
 assert.equal(displayPriceView(fixture(),4663,token,now+59000).status,'stale');
});
test('switching targets cannot render a late response for the previous target',async(t)=>{
 const pending:((r:Response)=>void)[]=[];
 t.mock.method(globalThis,'fetch',()=>new Promise<Response>(resolve=>pending.push(resolve)));
 const element={textContent:'',dataset:{}} as unknown as HTMLElement;
 const widget=mountDisplayPrice(element,'https://api.example',4663);t.after(()=>widget.stop());
 widget.setToken(token);const other=`0x${'4'.repeat(40)}`;widget.setToken(other);assert.equal(pending.length,2);
 pending[1]!(new Response(JSON.stringify(fixture(Date.now(),other))));await new Promise(resolve=>setImmediate(resolve));assert.match(element.textContent??'',/26\.68125/);
 const stale=fixture(Date.now(),token);stale.references[0]!.bidUsd='99';stale.references[0]!.askUsd='100';pending[0]!(new Response(JSON.stringify(stale)));await new Promise(resolve=>setImmediate(resolve));assert.doesNotMatch(element.textContent??'',/\$99/);
 widget.setToken(null);assert.match(element.textContent??'',/unavailable/);
});
test('full catalog remains readable and oversized responses are rejected',()=>{
 const data=fixture();
 const template=data.references[0]!;
 data.references=Array.from({length:64},(_,i)=>({...template,token:`0x${(i+1).toString(16).padStart(40,'0')}`}));
 const selected=data.references[63]!.token;
 assert.equal(displayPriceView(data,4663,selected,now).status,'available');
 data.references.push({...template,token:`0x${'f'.repeat(40)}`});
 assert.equal(displayPriceView(data,4663,selected,now).status,'unavailable');
});


test('timed out price requests release the refresh loop and cannot later overwrite it',async(t)=>{
 t.mock.timers.enable({apis:['setTimeout','setInterval']});
 const pending:((r:Response)=>void)[]=[];
 t.mock.method(globalThis,'fetch',(_input: unknown, init?:RequestInit)=>{assert.equal(init?.cache,'no-store');return new Promise<Response>(resolve=>pending.push(resolve));});
 const element={textContent:'',dataset:{}} as unknown as HTMLElement;
 const widget=mountDisplayPrice(element,'https://api.example',4663);t.after(()=>widget.stop());
 widget.setToken(token);assert.equal(pending.length,1);
 t.mock.timers.tick(8000);await new Promise(resolve=>setImmediate(resolve));
 assert.equal(element.dataset.priceStatus,'unavailable');
 t.mock.timers.tick(22000);assert.equal(pending.length,2);
 pending[1]!(new Response(JSON.stringify(fixture(Date.now()))));await new Promise(resolve=>setImmediate(resolve));
 assert.equal(element.dataset.priceStatus,'available');
 const late=fixture(Date.now());late.references[0]!.bidUsd='99';late.references[0]!.askUsd='100';
 pending[0]!(new Response(JSON.stringify(late)));await new Promise(resolve=>setImmediate(resolve));
 assert.doesNotMatch(element.textContent??'',/\$99/);
 widget.stop();assert.equal(element.dataset.priceStatus,'unavailable');assert.doesNotMatch(element.textContent??'',/26\.68/);
});
