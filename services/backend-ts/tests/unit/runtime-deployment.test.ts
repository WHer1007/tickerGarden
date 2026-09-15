import test from 'node:test';import assert from 'node:assert/strict';import {execFileSync} from 'node:child_process';
import {selectRuntimeChain} from '../../packages/runtime-deployment/src/index.ts';
test('runtime chain selection rejects cross-environment identities',()=>{
 assert.equal(selectRuntimeChain({TG_ENVIRONMENT:'test',TG_CHAIN_ID:'46630'}),46630);
 assert.equal(selectRuntimeChain({TG_ENVIRONMENT:'production',TG_CHAIN_ID:'4663'}),4663);
 for(const env of [{TG_ENVIRONMENT:'production',TG_CHAIN_ID:'46630'},{TG_ENVIRONMENT:'test',TG_CHAIN_ID:'4663'},{TG_ENVIRONMENT:'test',VERCEL_ENV:'production'}])assert.throws(()=>selectRuntimeChain(env));
});
test('mainnet cold start binds modules and bootstrap to the actual deployed release',()=>{
 const code=`import assert from 'node:assert/strict';import {CURRENT_CHAIN_ID,runtimeConfigs} from './packages/runtime-deployment/src/index.ts';import {CURRENT_RELEASE_ID,fixedF72Sources,f72EventCatalog} from './packages/events/src/index.ts';assert.equal(CURRENT_CHAIN_ID,4663);assert.equal(runtimeConfigs.length,392);assert.equal(runtimeConfigs.filter(c=>c.kind==='asset').length,194);assert.equal(runtimeConfigs.filter(c=>c.kind==='quote').length,196);assert.ok(runtimeConfigs.every(c=>c.source.chainId===4663));assert.equal(CURRENT_RELEASE_ID,'0xda13cee41cf89064426e10cd5b2f63cb8448fb5b4e8713f2d48d2f99b9570cd5');assert.equal(f72EventCatalog.TickerGardenFactoryV1.address,'0x5ebc1c14dc10aac61a1d1e59b2618ab1f4c3de9c');assert.ok(fixedF72Sources().every(s=>s.birthBlock===63094312n));`;
 execFileSync(process.execPath,['--experimental-strip-types','--input-type=module','-e',code],{env:{...process.env,TG_ENVIRONMENT:'production',TG_CHAIN_ID:'4663',VERCEL_ENV:'production'},stdio:'pipe'});
});

test('mainnet prices cover 194 targets in bounded batches without testnet RPC', () => {
 const code = `import assert from 'node:assert/strict';
 import {f72PriceTargets,fetchRuntimePriceReferences} from './packages/display-price/src/index.ts';
 let assetRequests=0;
 const fetcher=async(input)=>{const url=new URL(String(input));
 if(url.hostname==='api.coinbase.com'){assert.ok(!url.pathname.includes('USDG'));const base=url.pathname.includes('ETH-USD')?'ETH':'USDG';return Response.json({data:{base,currency:'USD',amount:base==='ETH'?'2000':'1.001'}});}
 if(url.pathname.endsWith('/assets')){assetRequests++;return Response.json({assets:[]});}
 if(url.pathname.endsWith('/corporate-actions'))return Response.json({corpActions:[]});
 return Response.json({quotes:[]});};
 const rows=await fetchRuntimePriceReferences(f72PriceTargets(),{fetcher,rpc:{request:async()=>{throw Error('must not call testnet RPC')}}});
 assert.equal(rows.length,196);assert.equal(assetRequests,4);
 assert.ok(rows.filter(r=>r.source==='robinhood_rest').every(r=>r.status==='unavailable'));
 assert.equal(rows.find(r=>r.symbol==='ETH').bidUsd,'2000');
 assert.equal(rows.find(r=>r.symbol==='USDG').bidUsd,'1');assert.equal(rows.find(r=>r.symbol==='USDG').source,'fixed_usd');`;
 execFileSync(process.execPath,['--experimental-strip-types','--input-type=module','-e',code],{env:{...process.env,TG_ENVIRONMENT:'production',TG_CHAIN_ID:'4663',VERCEL_ENV:'production'},stdio:'pipe'});
});

test('production Pipeline starts with one explicit RPC and no secondary readiness requirement',()=>{
 const code=`import assert from 'node:assert/strict';import {createPipelineApp} from './apps/pipeline/src/index.ts';
 const env={...process.env,TG_ALLOWED_ORIGINS:'https://example.test'};
 for(const key of ['TG_PIPELINE_DATABASE_URL','TG_PIPELINE_GENERATION','QSTASH_CURRENT_SIGNING_KEY','QSTASH_NEXT_SIGNING_KEY','QSTASH_CHAIN_TOKEN','TG_CHAIN_JOB_CALLBACK_URL','TG_RPC_URL','TG_REPAIR_TOKEN','TG_PRICE_REFRESH_TOKEN','CRON_SECRET'])env[key]='https://unused.example';
 const app=createPipelineApp({env});const response=await app.request('/internal/ready');assert.equal(response.status,200,await response.text());`;
 execFileSync(process.execPath,['--experimental-strip-types','--input-type=module','-e',code],{env:{...process.env,TG_ENVIRONMENT:'production',TG_CHAIN_ID:'4663',TG_RPC_VERIFICATION_MODE:'single',TG_SECONDARY_RPC_URL:'',TG_LOGS_SECONDARY_RPC_URL:'',VERCEL_ENV:'production'},stdio:'pipe'});
});
