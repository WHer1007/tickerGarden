import assert from 'node:assert/strict';
import test from 'node:test';
import {applyDisplayEvents,emptyDisplayState,displayDetail} from '../../packages/confirmed-display/src/state.ts';
import {runtimeConfigs} from '../../packages/runtime-deployment/src/index.ts';
import type {MarketReadModel} from '../../openapi/generated/v1-client.ts';
import type {MarketCreation} from '../../packages/market-projector/src/index.ts';
import type {EventObservation} from '../../packages/analytics/src/index.ts';
const address=(x:string)=>`0x${x.repeat(40)}` as `0x${string}`,hash=(x:string)=>`0x${x.repeat(64)}` as `0x${string}`;
const baseline=runtimeConfigs.find(c=>c.kind==='baseline')!,quote=runtimeConfigs.find(c=>c.kind==='quote'&&c.values.quoteAsset===address('0'))!;
const supply=String(baseline.values.supply),time=1720000010n;
const block={number:10n,hash:hash('a'),parentHash:hash('b'),timestamp:time};
const market={marketId:hash('1'),memeToken:address('2'),curve:address('3'),gauge:address('0'),quoteAsset:address('0'),quoteAssetConfigId:quote.id,tickerGardenBaselineId:baseline.id,poolId:null,poolKey:null,source:{chainId:46630,blockNumber:'10'},identity:{deployedAt:String(time)},display:{totalSupplyRaw:supply,priceQuote:'0.01'}} as unknown as MarketReadModel;
const creation={...market,expectedEconomics:quote.id} as unknown as MarketCreation;
const event=(name:string,args:Record<string,unknown>,index:bigint,emitter=market.memeToken):EventObservation=>({timestamp:time,event:{module:name==='Transfer'?'TickerMemeTokenV1':'TickerGardenCurve',eventName:name,args,log:{address:emitter,blockNumber:10n,blockHash:hash('a'),transactionHash:hash('c'),transactionIndex:0n,logIndex:index,data:'0x',topics:[],removed:false}}});
const mint=event('Transfer',{from:address('0'),to:market.curve,value:BigInt(supply)},0n);
const transfer=event('Transfer',{from:market.curve,to:address('5'),value:10n**18n},1n);
const buy=event('CurveBuy',{buyer:address('5'),recipient:address('5'),quoteIn:10n**16n,tokensOut:10n**18n,fee:0n,tax:0n},2n,market.curve);
test('confirmed display applies mint, buy and holders without a finality wait',()=>{
 const seed=emptyDisplayState(creation,market,block),next=applyDisplayEvents(seed,market,[mint,transfer,buy],block),detail=displayDetail(next,'1D');
 assert.equal(seed.supply,'0');assert.equal(detail.holders?.totalSupplyRaw,supply);assert.equal(detail.holders?.count,1);assert.equal(detail.statistics?.volume24h,'0.01');assert.equal(detail.trades?.length,1);
 assert.equal(detail.chart?.points.at(-1)?.price,'0.01');assert.ok(detail.chart!.to>Number(time));
 assert.throws(()=>applyDisplayEvents(next,market,[buy],block),/already applied/);
});
test('burn changes current supply, not the fixed supply; undo snapshot restores exact prior values',()=>{
 const before=applyDisplayEvents(emptyDisplayState(creation,market,block),market,[mint,transfer,buy],block);
 const burned={...market,display:{...market.display!,totalSupplyRaw:(BigInt(supply)-10n**18n).toString()}};
 const burn=event('Transfer',{from:address('5'),to:address('0'),value:10n**18n},3n);
 const after=applyDisplayEvents(before,burned,[burn],{...block,number:11n});
 assert.equal(displayDetail(after,'1H').holders?.count,0);assert.equal(after.supply,burned.display.totalSupplyRaw);
 assert.equal(before.supply,supply);assert.equal(before.balances[address('5')],String(10n**18n));assert.equal(baseline.values.supply,supply);
});
test('inconsistent receipt supply and duplicate logs fail before a state is published',()=>{
 const seed=emptyDisplayState(creation,market,block);
 assert.throws(()=>applyDisplayEvents(seed,market,[mint,mint],block));
 assert.throws(()=>applyDisplayEvents(seed,{...market,display:{...market.display!,totalSupplyRaw:'1'}},[mint],block),/disagrees/);
});

test('scoped confirmed reads omit unrelated sections and retain the open candle',()=>{
 const state=applyDisplayEvents(emptyDisplayState(creation,market,block),market,[mint,transfer,buy],block);
 const value=displayDetail(state,'1H',Number(time),'chart,trades');
 assert.equal(value.holders,null);assert.equal(value.fees,null);assert.equal(value.statistics,null);
 assert.deepEqual(Object.keys(value.sources).sort(),['chart','trades']);
 assert.equal(value.chart?.points.at(-1)?.price,'0.01');assert.equal(value.trades?.length,1);
});
