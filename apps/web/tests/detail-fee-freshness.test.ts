import assert from 'node:assert/strict';
import test from 'node:test';
import {mountTokenDetail} from '../src/v1/tokenDetailWidget.ts';
import {detailChartWindow} from '../src/v1/detailChart.ts';

 class Element {
  textContent='';title='';hidden=false;writes=0;rows=0;onclick?:()=>void;dataset:Record<string,string>={};style={};
  classList={toggle(){},add(){}};
  hasAttribute(){return false;} setAttribute(){} removeAttribute(){} children:Element[]=[]; append(...args:Element[]){this.writes++;this.children.push(...args);}
  replaceChildren(){this.writes++;this.rows=0;this.children=[];} insertRow(){this.rows++;return {insertCell:()=>new Element()};}
  getContext(){return null;} querySelector(){return null;} querySelectorAll(){return [];}
 }

// Minimal DOM for deterministic field and failure transitions; no RPC.
async function withDetail(run:(h:{widget:ReturnType<typeof mountTokenDetail>;node:(key:string)=>Element;buttons:Element[];fail:(value:boolean)=>void;calls:URL[]})=>Promise<void>){
 const saved=new Map<string,PropertyDescriptor|undefined>();
 const install=(key:string,value:unknown)=>{saved.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});};
 const nodes=new Map<string,Element>();const node=(key:string)=>{if(!nodes.has(key))nodes.set(key,new Element());return nodes.get(key)!;};
 const buttons=['1H','12H','1D'].map(period=>{const el=new Element();el.dataset.detailPeriod=period;return el;});
 const root={querySelector:node,querySelectorAll:(key:string)=>key==='[data-detail-period]'?buttons:key.split(',').map(node)};
 const id={marketId:`0x${'1'.repeat(64)}` as `0x${string}`,memeToken:`0x${'2'.repeat(40)}`,quoteAsset:`0x${'3'.repeat(40)}`,quoteDecimals:18,symbol:'TEST',quoteSymbol:'ETH'};
 const asOf=Math.floor(Date.now()/1000/900)*900;const hash=`0x${'4'.repeat(64)}`;
 const initial=detailChartWindow('1H',asOf);
 const detail={version:1,chainId:46630,displayOnly:true,...id,period:'1H',statistics:{price:'2',volume24h:'12.5',volumeFrom:asOf-86400,volumeTo:asOf,volumeBasis:'EXTERNAL_EXECUTIONS_CURVE_EXCLUDING_FEE_TAX_OR_POOL_CORE',marketCapUsd:'987.65'},holders:{basis:'TOTAL_MINUS_KNOWN_PROTOCOL_BALANCES_V1',totalSupplyRaw:'1000000000000000000000',circulatingSupplyRaw:'900000000000000000000',count:42,items:[]},trades:[],fees:[],reasons:{},chart:{...initial,points:Array.from({length:60},(_,i)=>({timestamp:initial.from+i*60,price:null}))},sources:Object.fromEntries(['chart','trades','fees','statistics','holders'].map(key=>[key,{provider:'indexer',asOf,blockNumber:'10',blockHash:hash}]))};
 const calls:URL[]=[];let failure=false;
 install('document',{visibilityState:'visible',addEventListener(){},removeEventListener(){},createElement:()=>new Element()});
 install('window',{addEventListener(){},removeEventListener(){}});
 install('navigator',{onLine:true});install('ResizeObserver',class{observe(){}disconnect(){}});
 install('fetch',async(input:string|URL)=>{
  const url=new URL(String(input));calls.push(url);
  assert.ok(url.pathname.endsWith('/detail'));
  if(failure)return Response.json({error:'analytics_unavailable',message:'Unavailable'},{status:503});
  const period=url.searchParams.get('period')??'1H',interval=period==='1H'?60:300,duration=period==='1H'?3600:43200;
  return Response.json({...detail,confirmation:'confirmed',period,chart:{from:asOf-duration,to:asOf,interval,points:Array.from({length:duration/interval},(_,i)=>({timestamp:asOf-duration+i*interval,price:i===0?'1':i===1?'2':null}))}});
 });
 let widget:ReturnType<typeof mountTokenDetail>|undefined;
 const flush=()=>new Promise(resolve=>setImmediate(resolve));
 try{
  detail.fees=[{asset:id.quoteAsset,recipient:'creator',amountRaw:'1000000000000000000'}] as never;
  widget=mountTokenDetail(root as unknown as HTMLElement,'https://read.example',46630,'https://explorer.example');
  widget.setMarket(id);await flush();await flush();
  widget.setFeeConfig({phase:0,stakingEnabled:false,active:false,holders:false,taxBps:0,baseFeeBps:100,lpFeePips:1000});
  await run({widget,node,buttons,fail:value=>{failure=value;},calls});
 }finally{widget?.stop();for(const[key,descriptor]of saved){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else Reflect.deleteProperty(globalThis,key);}}
}

const flush=()=>new Promise(resolve=>setImmediate(resolve));
test('unavailable USD clears fee valuation and a fresh quote restores it',()=>withDetail(async({widget,node})=>{
 widget.setOverview({price:'2',usd:'2000'});
 const value=()=>node('[data-detail-fee-rows]').children[0]?.children[3]?.textContent;
 assert.equal(value(),'$2,000.00');widget.setOverview({usd:null});assert.equal(value(),'-');
 widget.setOverview({usd:'2100'});assert.equal(value(),'$2,100.00');
}));
test('failed new period cannot show old-period values and the same button retries only the chart',()=>withDetail(async({node,buttons,fail,calls})=>{
 assert.equal(node('[data-detail-change]').textContent,'+100.00% (1H)');
 fail(true);buttons[1]!.onclick!();await flush();await flush();
 assert.equal(node('[data-detail-change]').textContent,'-');assert.match(node('[data-detail-source]').textContent,/12H chart unavailable/);assert.equal(node('[data-detail-retry]').hidden,false);
 assert.equal(calls.at(-1)?.searchParams.get('section'),'chart');const summaries=calls.filter(u=>!u.searchParams.has('section')).length;
 fail(false);buttons[1]!.onclick!();await flush();await flush();assert.equal(node('[data-detail-change]').textContent,'+100.00% (12H)');assert.equal(node('[data-detail-retry]').hidden,true);
 assert.equal(calls.filter(u=>!u.searchParams.has('section')).length,summaries);
}));
test('failed confirmed summary retains values with an explicit failure state and recovers',()=>withDetail(async({widget,node,fail})=>{
 const cap=node('[data-detail-cap]').textContent;fail(true);await widget.refresh(true);
 assert.equal(node('[data-detail-cap]').textContent,cap);assert.match(node('[data-detail-source]').textContent,/Refresh failed/);assert.equal(node('[data-detail-retry]').hidden,false);
 fail(false);await widget.refresh(true);assert.doesNotMatch(node('[data-detail-source]').textContent,/Refresh failed/);assert.equal(node('[data-detail-retry]').hidden,true);
}));
