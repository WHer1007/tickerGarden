import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
const source=readFileSync(new URL('../src/controllers/trade.ts',import.meta.url),'utf8');
const start=source.indexOf('async function loadTradeMarket('),end=source.indexOf('\nasync function renderTradeFeeDetails',start);
const functionSource=ts.transpile(source.slice(start,end),{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext});
test('cold detail refresh waits for the shared bootstrap without flashing unavailable',async()=>{
 let finish!:()=>void;const pending=new Promise<void>(r=>{finish=r;});const states:unknown[]=[];const loading:boolean[]=[];
 const marketId='0x'+'1'.repeat(64);
 const ctx:any={tradeMarket:null,tradeLoadGeneration:0,tradeQuoteGeneration:0,readApi:{},foundation:null,currentPage:()=> 'trade',loadFoundation:()=>pending};
 const run=new Function('ctx','window','setTradePageLoading','clearTradeMarketState','canonicalBytes32','preparedCreatedMarket','renderTradeEmptyState','updateTradeAvailability',functionSource+';return loadTradeMarket;')(ctx,{location:{href:'https://example.test/trade?marketId='+marketId},clearTimeout(){}},(value:boolean)=>loading.push(value),()=>{},(s:string)=>s,()=>null,(s:unknown)=>states.push(s),()=>{});
 const request=run();await Promise.resolve();
 assert.deepEqual(states,[null]);assert.equal(loading.at(-1),true);
 // A newer route owns the UI when the shared request resolves.
 ctx.tradeLoadGeneration++;finish();await request;assert.deepEqual(states,[null]);
});
test('unavailable is rendered only after the shared bootstrap finishes without a market',async()=>{
 let finish!:()=>void;const pending=new Promise<void>(r=>{finish=r;});const states:unknown[]=[];
 const marketId='0x'+'1'.repeat(64);
 const ctx:any={tradeMarket:null,tradeLoadGeneration:0,tradeQuoteGeneration:0,readApi:{},foundation:null,currentPage:()=> 'trade',loadFoundation:()=>pending};
 const run=new Function('ctx','window','setTradePageLoading','clearTradeMarketState','canonicalBytes32','preparedCreatedMarket','renderTradeEmptyState','updateTradeAvailability',functionSource+';return loadTradeMarket;')(ctx,{location:{href:'https://example.test/trade?marketId='+marketId},clearTimeout(){}},()=>{},()=>{},(s:string)=>s,()=>null,(s:unknown)=>states.push(s),()=>{});
 const request=run();assert.deepEqual(states,[null]);finish();await request;assert.deepEqual(states,[null,'unavailable']);
});
