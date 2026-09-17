import assert from 'node:assert/strict';
import test from 'node:test';
import {mountTokenDetail} from '../src/v1/tokenDetailWidget.ts';
import {detailChartWindow} from '../src/v1/detailChart.ts';

// A minimal DOM harness counts writes to unrelated sections. No browser or RPC.
test('period switches fetch only candles, preserve summary DOM and reject late responses',async()=>{
 const saved=new Map<string,PropertyDescriptor|undefined>();
 const install=(key:string,value:unknown)=>{saved.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});};
 class Element {
  textContent='';title='';hidden=false;writes=0;onclick?:()=>void;dataset:Record<string,string>={};style={};
  classList={toggle(){},add(){}};
  setAttribute(){} removeAttribute(){} append(..._args:unknown[]){this.writes++;}
  replaceChildren(){this.writes++;} insertRow(){return {insertCell:()=>new Element()};}
  getContext(){return null;} querySelector(){return null;} querySelectorAll(){return [];}
 }
 const nodes=new Map<string,Element>();const node=(key:string)=>{if(!nodes.has(key))nodes.set(key,new Element());return nodes.get(key)!;};
 const buttons=['1H','12H','1D'].map(period=>{const el=new Element();el.dataset.detailPeriod=period;return el;});
 const root={querySelector:node,querySelectorAll:(key:string)=>key==='[data-detail-period]'?buttons:key.split(',').map(node)};
 const id={marketId:`0x${'1'.repeat(64)}` as `0x${string}`,memeToken:`0x${'2'.repeat(40)}`,quoteAsset:`0x${'3'.repeat(40)}`,quoteDecimals:18,symbol:'TEST',quoteSymbol:'ETH'};
 const asOf=Math.floor(Date.now()/1000/900)*900;const hash=`0x${'4'.repeat(64)}`;
 const initial=detailChartWindow('1H',asOf);
 const detail={version:1,chainId:46630,displayOnly:true,...id,period:'1H',statistics:{price:'2',volume24h:'12.5',volumeFrom:asOf-86400,volumeTo:asOf,volumeBasis:'EXTERNAL_EXECUTIONS_CURVE_EXCLUDING_FEE_TAX_OR_POOL_CORE',marketCapUsd:'987.65'},holders:{basis:'TOTAL_MINUS_KNOWN_PROTOCOL_BALANCES_V1',totalSupplyRaw:'1000000000000000000000',circulatingSupplyRaw:'900000000000000000000',count:42,items:[]},trades:[],fees:[],reasons:{},chart:{...initial,points:Array.from({length:60},(_,i)=>({timestamp:initial.from+i*60,price:null}))},sources:Object.fromEntries(['chart','trades','fees','statistics','holders'].map(key=>[key,{provider:'indexer',asOf,blockNumber:'10',blockHash:hash}]))};
 const calls:URL[]=[];let failSummary=false;let release12:((value:Response)=>void)|undefined;let slow12:Response|undefined;
 install('document',{visibilityState:'visible',addEventListener(){},removeEventListener(){},createElement:()=>new Element()});
 install('window',{addEventListener(){},removeEventListener(){}});
 install('navigator',{onLine:true});install('ResizeObserver',class{observe(){}disconnect(){}});
 install('fetch',async(input:string|URL)=>{
  const url=new URL(String(input));calls.push(url);
  if(url.pathname.endsWith('/detail')){if(failSummary){failSummary=false;return Response.json({error:'analytics_unavailable',message:'Unavailable'},{status:503});}return Response.json(detail);}
  assert.ok(url.pathname.endsWith('/candles'));
  const from=Number(url.searchParams.get('from')),to=Number(url.searchParams.get('to')),interval=url.searchParams.get('interval')==='1m'?60:url.searchParams.get('interval')==='5m'?300:900;
  const response=Response.json({chainId:46630,displayOnly:true,marketId:id.marketId,memeAsset:id.memeToken,quoteAsset:id.quoteAsset,quoteDecimals:18,interval,coverage:{from,to,anchorNumber:1,throughNumber:10,projectionNumber:10,anchorHash:hash,throughHash:hash,projectionHash:hash},series:{priceUnit:'QUOTE_PER_WHOLE_MEME',volumeBasis:'CURVE_EXCLUDING_FEE_TAX_OR_POOL_CORE',pricePopulation:'ALL_EXECUTIONS_INCLUDING_INTERNAL_CONVERSIONS',emptyPolicy:'NULL_OHLC_ZERO_VOLUME',candles:Array.from({length:(to-from)/interval},(_,i)=>({timestamp:from+i*interval,open:{numerator:'1',denominator:'1'},low:{numerator:'1',denominator:'1'},high:{numerator:'2',denominator:'1'},close:{numerator:i?'2':'1',denominator:'1'},tradeCount:1,internalTradeCount:0,unclassifiedTradeCount:1,memeVolumeRaw:'1',quoteVolumeRaw:'1',internalMemeVolumeRaw:'0',internalQuoteVolumeRaw:'0'}))}});
  if(interval===300){slow12=response;return new Promise<Response>(resolve=>{release12=resolve;});}return response;
 });
 let widget:ReturnType<typeof mountTokenDetail>|undefined;
 const flush=()=>new Promise(resolve=>setImmediate(resolve));
 try{
  widget=mountTokenDetail(root as unknown as HTMLElement,'https://read.example',46630,'https://explorer.example');
  widget.setMarket(id);await flush();await flush();assert.equal(calls.length,1);
  assert.equal(node('[data-detail-volume]').textContent,'12.5 ETH');
  assert.equal(node('[data-detail-holders]').textContent,'42');
  assert.notEqual(node('[data-detail-circulating]').textContent,'-');
  assert.equal(node('[data-detail-cap]').textContent,'$987.65','market cap comes directly from backend snapshot');
  widget.setOverview({price:'3',supply:'1000000000000000000000',usd:'2000'});
  assert.equal(node('[data-detail-cap]').textContent,'$987.65','frontend price inputs do not recalculate backend market cap');
  widget.setMarket({...id});await flush();
  assert.equal(node('[data-detail-volume]').textContent,'12.5 ETH','same-market bootstrap retains validated analytics');
  assert.equal(node('[data-detail-holders]').textContent,'42');
  assert.notEqual(node('[data-detail-cap]').textContent,'-','same-market bootstrap retains overview inputs');
  failSummary=true;await widget.refresh(true);await flush();
  assert.equal(node('[data-detail-volume]').textContent,'12.5 ETH','failed refresh retains validated metrics');
  assert.equal(node('[data-detail-holders]').textContent,'42');
  assert.notEqual(node('[data-detail-cap]').textContent,'-');
  const before=node('[data-detail-trades-body]').writes;
  buttons[1]!.onclick!();await flush();buttons[2]!.onclick!();await flush();await flush();
  assert.equal(calls.filter(url=>url.pathname.endsWith('/detail')).length,2);
  assert.deepEqual(calls.filter(url=>url.pathname.endsWith('/candles')&&url.searchParams.get('interval')!=='1m').map(url=>url.searchParams.get('interval')),['5m','15m']);
  assert.match(node('[data-detail-change]').textContent,/\(1D\)$/);
  release12!(slow12!);await flush();await flush();assert.match(node('[data-detail-change]').textContent,/\(1D\)$/);
  const callsBeforeCachedPeriod=calls.length;buttons[0]!.onclick!();await flush();assert.equal(calls.length,callsBeforeCachedPeriod,'cached 1H needs no request');
  assert.equal(node('[data-detail-trades-body]').writes,before,'period selection does not rebuild trade history');
  buttons[1]!.onclick!();await flush();release12!(Response.json({error:'analytics_unavailable',message:'Unavailable'},{status:503}));await flush();await flush();
  assert.equal(calls.filter(url=>url.pathname.endsWith('/detail')).length,2);
  assert.equal(node('[data-detail-trades-body]').writes,before,'chart errors do not reset summary data');

  // A slow/failing summary must not hold the public price or initial chart.
  widget.stop();calls.length=0;
  const normalFetch=globalThis.fetch;
  let releaseSummary:((value:Response)=>void)|undefined;
  globalThis.fetch=async(input,init)=>{
   const url=new URL(String(input));
   if(url.pathname.endsWith('/detail')){calls.push(url);return new Promise<Response>(resolve=>{releaseSummary=resolve;});}
   return normalFetch(input,init);
  };
  widget=mountTokenDetail(root as unknown as HTMLElement,'https://read.example',46630,'https://explorer.example');
  widget.prefetch(id.marketId);await flush();
  assert.equal(calls.length,1,'summary starts before market/configuration bootstrap completes');
  widget.setMarket(id);widget.setOverview({asOf,price:'1'});await flush();await flush();
  assert.equal(calls.filter(url=>url.pathname.endsWith('/detail')).length,1,'mount consumes the prefetch without duplicating it');
  assert.equal(calls.filter(url=>url.pathname.endsWith('/candles')).length,1,'initial chart starts while summary remains pending');
  assert.notEqual(node('[data-detail-price]').textContent,'-','database overview is visible before summary');
  assert.match(node('[data-detail-change]').textContent,/\(1H\)$/);
  const chartBeforeError=node('[data-detail-change]').textContent;
  releaseSummary!(Response.json({error:'analytics_unavailable',message:'Unavailable'},{status:503}));await flush();await flush();
  assert.equal(node('[data-detail-change]').textContent,chartBeforeError,'summary failure preserves independent chart');
  assert.notEqual(node('[data-detail-price]').textContent,'-','summary failure preserves database overview');
  widget.stop();calls.length=0;
  widget=mountTokenDetail(root as unknown as HTMLElement,'https://read.example',46630,'https://explorer.example');
  widget.prefetch(id.marketId);widget.setMarket(id);await flush();widget.setMarket(null);
  releaseSummary!(Response.json(detail));await flush();await flush();
  assert.equal(node('[data-detail-price]').textContent,'-','late old-market response cannot repopulate cleared details');
  assert.equal(calls.length,1,'cleared market does not launch a chart request');


 }finally{widget?.stop();for(const[key,descriptor]of saved){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else Reflect.deleteProperty(globalThis,key);}}
});
