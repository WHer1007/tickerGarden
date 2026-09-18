import assert from 'node:assert/strict';
import test from 'node:test';
import {circulatingCap,displayDecimal,feeRows,validateTokenDetail,type DetailIdentity} from '../src/v1/tokenDetail.ts';
import {safeDetailLink,readDetailMetadata} from '../src/v1/tokenMetadata.ts';
const id:DetailIdentity={marketId:`0x${'1'.repeat(64)}`,memeToken:`0x${'2'.repeat(40)}`,quoteAsset:`0x${'3'.repeat(40)}`,quoteDecimals:6,symbol:'TEST',quoteSymbol:'USDC'};
const now=1_700_000_040_000;
const report=()=>({version:1,chainId:46630,displayOnly:true,...id,period:'1H',statistics:null,chart:null,trades:null,holders:null,fees:null,sources:{},reasons:{}});
const source={provider:'indexer',asOf:now/1000,blockNumber:'10',blockHash:`0x${'4'.repeat(64)}`};
test('detail validates identity and numeric data without expiring unchanged indexer observations',()=>{
 const v=report();assert.equal(validateTokenDetail(v,46630,id,'1H',now).statistics,null);
 assert.throws(()=>validateTokenDetail({...v,chainId:1},46630,id,'1H',now));
 assert.throws(()=>validateTokenDetail({...v,memeToken:id.quoteAsset},46630,id,'1H',now));
 const withVolume={...v,statistics:{price:null,volume24h:'0',volumeFrom:now/1000-86400,volumeTo:now/1000,volumeBasis:'EXTERNAL_EXECUTIONS_CURVE_EXCLUDING_FEE_TAX_OR_POOL_CORE'},sources:{statistics:source}};
 assert.equal(validateTokenDetail(withVolume,46630,id,'1H',now).statistics?.volume24h,'0');
 assert.equal(validateTokenDetail(withVolume,46630,id,'1H',now+1_201_000).statistics?.volume24h,'0');
 assert.equal(validateTokenDetail(withVolume,46630,id,'1H',now-600_000).statistics?.volume24h,'0');
 assert.equal(validateTokenDetail({...withVolume,sources:{statistics:{...source,provider:'dune',queryId:'1',executionId:'a',cachedAt:now/1000}}},46630,id,'1H',now+1_201_000).statistics?.volume24h,'0');
 assert.throws(()=>validateTokenDetail({...withVolume,statistics:{...withVolume.statistics,volume24h:0}},46630,id,'1H',now));
});
test('chart periods require complete aligned buckets; gaps remain null',()=>{
 const to=now/1000,from=to-3600;const chart={from,to,interval:60,points:Array.from({length:60},(_,i)=>({timestamp:from+i*60,price:i%2?'0.0000283':null}))};
 const v={...report(),chart,sources:{chart:source}};assert.equal(validateTokenDetail(v,46630,id,'1H',now).chart?.points[0]?.price,null);
 assert.throws(()=>validateTokenDetail({...v,chart:{...chart,points:chart.points.slice(1)}},46630,id,'1H',now));
 assert.throws(()=>validateTokenDetail({...v,chart:{...chart,points:chart.points.map(p=>({...p,price:'NaN'}))}},46630,id,'1H',now));
});
test('1H chart accepts its older trade window while preserving bucket, duration, and future guards',()=>{
 const to=now/1000-7200,from=to-3600;const points=Array.from({length:60},(_,i)=>({timestamp:from+i*60,price:i===42?'0.0000283':null}));
 const chart={from,to,interval:60,points};const v={...report(),chart,sources:{chart:source}};
 const accepted=validateTokenDetail(v,46630,id,'1H',now);assert.equal(accepted.chart?.to,to);assert.equal(accepted.chart?.points.filter(p=>p.price!==null).length,1);
 assert.throws(()=>validateTokenDetail({...v,chart:{...chart,points:points.map((p,i)=>i===42?{...p,timestamp:p.timestamp+60}:p)}},46630,id,'1H',now));
 assert.throws(()=>validateTokenDetail({...v,chart:{...chart,from:from-60}},46630,id,'1H',now));
 assert.throws(()=>validateTokenDetail({...v,chart:{...chart,from:source.asOf-3540,to:source.asOf+60,points:Array.from({length:60},(_,i)=>({timestamp:source.asOf-3540+i*60,price:null}))}},46630,id,'1H',now));
});
test('circulating cap uses exact circulation rather than fixed supply or unsafe numbers',()=>{
 assert.equal(displayDecimal(circulatingCap('0.1','9007199254740993000000000000000000'),2),'900,719,925,474,099.3');
 assert.equal(circulatingCap(null,'1'),null);assert.equal(displayDecimal('0'),'0');assert.equal(displayDecimal('0.0000000000001'),'<0.00000001');
});
test('fee allocation represents actual curve / active pool and holder sharing',()=>{
 assert.deepEqual(feeRows({phase:0,stakingEnabled:true,active:true,holders:false,taxBps:0}).map(r=>r.percent),[70,30]);
 assert.deepEqual(feeRows({phase:1,stakingEnabled:true,active:true,holders:true,taxBps:100}).map(r=>r.percent),[20,20,30,30]);
 assert.deepEqual(feeRows({phase:1,stakingEnabled:true,active:null,holders:false,taxBps:0}).map(r=>r.percent),[null,null,30]);
 assert.deepEqual(feeRows({phase:1,stakingEnabled:false,active:false,holders:false,taxBps:0}).map(r=>r.key),['creator','platform']);
 assert.deepEqual(feeRows({phase:1,stakingEnabled:false,active:false,holders:true,taxBps:0}).map(r=>r.key),['creator','holders','platform']);
});
test('external metadata links never execute script and images remain content-addressed',async()=>{
 assert.equal(safeDetailLink('javascript:alert(1)'),null);assert.equal(safeDetailLink('https://evil.example/x',true),null);assert.equal(safeDetailLink('https://x.com/test',true),'https://x.com/test');
 assert.equal(await readDetailMetadata('https://evil.example/launch-metadata/a.json','https://content.example',new AbortController().signal),null);
 const original=globalThis.fetch;const value={description:'Launch description',properties:{website:'https://example.com',x:'https://x.com/tg'},image:''};const raw=JSON.stringify(value);const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(raw))),x=>x.toString(16).padStart(2,'0')).join('');
 globalThis.fetch=async()=>new Response(raw);
 try{const metadata=await readDetailMetadata(`https://content.example/launch-metadata/${digest}.json`,'https://content.example',new AbortController().signal);assert.equal(metadata?.website,'https://example.com/');assert.equal(metadata?.x,'https://x.com/tg');assert.equal(await readDetailMetadata(`https://content.example/launch-metadata/${'0'.repeat(64)}.json`,'https://content.example',new AbortController().signal),null);}finally{globalThis.fetch=original;}
});
