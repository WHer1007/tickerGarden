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

test('worker materializes USD cap from current total supply and the shared database quote',async()=>{
 const {materializeDisplay,displayUsd}=await import('../../packages/confirmed-display/src/state.ts');
 const state=applyDisplayEvents(emptyDisplayState(creation,market,block),market,[mint,transfer,buy],block);
 const materialized=materializeDisplay({...state,quoteUsd:'2'});
 assert.deepEqual(displayUsd('0.01','100000000000000000000','2'),{priceUsd:'0.02',marketCapUsd:'2'});
 assert.equal(materialized.detailViews?.['1H'].statistics?.marketCapUsd,formatCap(supply));
 assert.equal(materialized.detailViews?.['1D'].holders?.totalSupplyRaw,supply);
 assert.equal(materializeDisplay({...state,quoteUsd:null}).detailViews?.['1H'].statistics?.marketCapUsd,null);
 const aged=materializeDisplay({...state,quoteUsd:'2'},{number:'11',hash:hash('d'),timestamp:Number(time)+86401});
 assert.equal(aged.detailViews?.['1H'].statistics?.volume24h,'0');
 assert.equal(aged.detailViews?.['1H'].statistics?.price,'0.01');
 assert.equal(state.trades.length,1);
 function formatCap(raw:string){return String(BigInt(raw)/10n**18n/50n);}
});

test('detail read selects a stored view without recalculating windows or applying client expiry',async()=>{
 const {materializeDisplay}=await import('../../packages/confirmed-display/src/state.ts');
 const {readConfirmedDetail}=await import('../../packages/confirmed-display/src/read.ts');
 const state=materializeDisplay(applyDisplayEvents(emptyDisplayState(creation,market,block),market,[mint,transfer,buy],block));
 const stored=state.detailViews!['1H'];
 const pool={query:async(sql:string,args:unknown[])=>{assert.match(sql,/detailViews/);assert.equal(args.at(-1),'1H');return {rows:[{detail:stored}]};}} as any;
 const result=await readConfirmedDetail(pool,{environment:'test',chainId:46630,deploymentDigest:hash('8'),activationBlock:0n},market.marketId,'1H',undefined,'statistics,holders');
 assert.deepEqual(result?.statistics,stored.statistics);assert.deepEqual(result?.sources.statistics,stored.sources.statistics);
 assert.deepEqual(result?.holders,stored.holders);assert.equal(result?.trades,null);assert.equal(result?.chart,null);
});

test('quiet 1H chart retains only the last historical trade, including after 24h, until a new trade',()=>{
 const initial=applyDisplayEvents(emptyDisplayState(creation,market,block),market,[mint,transfer,buy],block);
 const later={...block,number:11n,hash:hash('d'),timestamp:time+90000n};
 const quiet=applyDisplayEvents(initial,market,[],later);
 assert.equal(quiet.trades.length,0);
 assert.equal(quiet.latestTrade?.timestamp,Number(time));
 const chart=displayDetail(quiet,'1H').chart!;
 assert.deepEqual(chart.points.filter(p=>p.price!==null),[{timestamp:Math.floor(Number(time)/60)*60,price:'0.01'}]);
 assert.ok(chart.to<Number(later.timestamp)-3600);
 assert.equal(displayDetail(quiet,'1H').statistics?.volume24h,'0');
 assert.ok(displayDetail(quiet,'12H').chart!.points.every(p=>p.price===null));
 assert.ok(displayDetail(quiet,'1D').chart!.points.every(p=>p.price===null));
 const newBuy={...buy,timestamp:later.timestamp,event:{...buy.event,log:{...buy.event.log,blockNumber:later.number,blockHash:later.hash,transactionHash:hash('e')}}};
 const updated=applyDisplayEvents(quiet,market,[newBuy],later);
 const updatedChart=displayDetail(updated,'1H').chart!;
 assert.equal(updated.latestTrade?.txHash,hash('e'));
 assert.ok(updatedChart.to>Number(later.timestamp));
 assert.deepEqual(updatedChart.points.filter(p=>p.price!==null),[{timestamp:Math.floor(Number(later.timestamp)/60)*60,price:'0.01'}]);
 assert.equal(quiet.latestTrade?.txHash,hash('c'));
 assert.ok(displayDetail(emptyDisplayState(creation,market,block),'1H').chart!.points.every(p=>p.price===null));
});

test('Explore materializes current cap, volume and latest buy independently of rolling history',async()=>{
 const {materializeDisplay}=await import('../../packages/confirmed-display/src/state.ts');
 const seed=applyDisplayEvents(emptyDisplayState(creation,market,block),market,[mint,transfer,buy],block);
 const current=materializeDisplay({...seed,quoteUsd:'2'});
 assert.equal(current.market.metrics?.volume24hUsd,'0.02');
 assert.equal(current.market.metrics?.marketCapUsd,current.detailViews?.['1H'].statistics?.marketCapUsd);
 assert.deepEqual(current.market.lastBuy,{blockNumber:'10',transactionIndex:'0',logIndex:'2',timestamp:String(time)});
 const quiet=materializeDisplay(applyDisplayEvents(current,market,[],{...block,number:11n,timestamp:time+86401n}));
 assert.equal(quiet.trades.length,0);assert.equal(quiet.market.metrics?.volume24hUsd,'0');
 assert.deepEqual(quiet.market.lastBuy,current.market.lastBuy);
 assert.equal(seed.market.metrics,undefined);
 const undo=materializeDisplay({...seed,latestBuy:null});assert.equal(undo.market.lastBuy,undefined);
});

test('recent activity keeps the latest 30 indefinitely, independently of chart and volume windows',()=>{
 const initial=applyDisplayEvents(emptyDisplayState(creation,market,block),market,[mint,transfer,buy],block);
 const old=Array.from({length:35},(_,i)=>({...initial.trades[0]!,timestamp:Number(time)-90000-i*86400,eventKey:`old-${i}`}));
 const {recentTrades:_recent,...withoutRecent}=initial;
 const seeded={...withoutRecent,trades:old,latestTrade:old[0]!};
 const quiet=applyDisplayEvents(seeded,market,[],block);
 assert.equal(quiet.trades.length,0,'rolling statistics buffer excludes historical executions');
 assert.equal(quiet.recentTrades?.length,30);
 for(const period of ['1H','12H','1D'] as const){
  const detail=displayDetail(quiet,period);
  assert.deepEqual(detail.trades,old.slice(0,30));
  assert.equal(detail.statistics?.volume24h,'0');
 }
 const newer={...buy,event:{...buy.event,log:{...buy.event.log,transactionHash:hash('e')}}};
 const updated=applyDisplayEvents(quiet,market,[newer],block);
 assert.equal(updated.recentTrades?.length,30);
 assert.equal(updated.recentTrades?.[0]?.txHash,hash('e'));
 assert.deepEqual(updated.recentTrades?.slice(1),old.slice(0,29));
 assert.equal(displayDetail(updated,'1D').statistics?.volume24h,'0.01');
 assert.deepEqual(quiet.recentTrades,old.slice(0,30),'predecessor remains intact for reorg rollback');
});

test('worker backfills old recent trades once and merges newer receipt data without duplicates',async()=>{
 const {hydrateDisplayHistory}=await import('../../packages/confirmed-display/src/history.ts');
 const initial=applyDisplayEvents(emptyDisplayState(creation,market,block),market,[mint,transfer,buy],block);
 const old=Array.from({length:30},(_,i)=>({timestamp:String(Number(time)-90000-i),side:'buy',price:{numerator:'1',denominator:'100'},memeRaw:'1',quoteRaw:'1',actor:null,classification:'unclassified',source:{transactionHash:hash('f'),eventKey:`old-${i}`}}));
 let calls=0;
 const pool={query:async(sql:string,args:unknown[])=>{calls++;assert.match(sql,/LIMIT 30/);assert.doesNotMatch(sql,/occurred_at\s*[<>]/);assert.match(sql,/b\.canonical AND b\.finalized AND b\.number<=\$5/);assert.equal(args[3],market.marketId);return{rows:old.map(payload=>({payload}))};}} as any;
 const restored=await hydrateDisplayHistory(pool,{environment:'test',chainId:46630,deploymentDigest:hash('8'),activationBlock:0n},initial);
 assert.equal(restored.recentTradesHydrated,true);assert.equal(restored.recentTrades?.length,30);
 assert.equal(restored.recentTrades?.[0]?.eventKey,initial.trades[0]?.eventKey);
 assert.equal(new Set(restored.recentTrades?.map(t=>t.eventKey)).size,30);
 assert.equal(restored.recentTrades?.at(-1)?.eventKey,'old-28');
 await hydrateDisplayHistory(pool,{environment:'test',chainId:46630,deploymentDigest:hash('8'),activationBlock:0n},restored);
 assert.equal(calls,1,'maintenance must not repeatedly scan historical trades');
});
