import fs from 'node:fs';
import {spawn} from 'node:child_process';
import {readProjectEnv} from './environment.mjs';
import {createPinnedRpcProxy} from './robinhood-rpc-compat-proxy.mjs';
import {RollingCuLimiter} from './service-integration/rpc-cu-budget.mjs';
const run=process.env.TG_RH_DEPLOYMENT_RUN;if(!run||!/^[a-z0-9-]+$/.test(run))throw Error('Explicit run required');
const out=`outputs/reviews/${run}`,read=p=>JSON.parse(fs.readFileSync(p));
const state=read(out+'-matrix/results.json'),b=read(`deployments/releases/${state.releaseId}/frontend-bootstrap.json`);
const m=state.markets[0];if(!m.graduated||!m.distributor)throw Error('Public lifecycle data required');
const e=readProjectEnv('test'),endpoint=`https://robinhood-testnet.g.alchemy.com/v2/${e.ALCHEMY_API_KEY}`;
const originalFetch=globalThis.fetch,limiter=new RollingCuLimiter({maxCu:1000}),cache=new Map(),pending=new Map(),stats={upstream:0,hits:0,methods:{}};
// All fork reads share this 1,000 CU/s budget; the ordinary gateway is lowered
// to 9,000 CU/s for this run. Cache immutable pinned state across all nine tests.
globalThis.fetch=async(url,options)=>{
 if(url!==endpoint)return originalFetch(url,options);
 const body=JSON.parse(options.body),calls=Array.isArray(body)?body:[body];
 const results=await Promise.all(calls.map(async call=>{
  const key=JSON.stringify([call.method,call.params]);let payload=cache.get(key);
  if(payload)stats.hits++;else {
   if(!pending.has(key))pending.set(key,(async()=>{await limiter.acquire(500);stats.upstream++;stats.methods[call.method]=(stats.methods[call.method]??0)+1;const response=await originalFetch(url,{...options,body:JSON.stringify(call)});if(!response.ok)throw Error('Fork upstream HTTP '+response.status);const value=await response.json();if(!value.error)cache.set(key,value);return value;})());
   try{payload=await pending.get(key);}finally{pending.delete(key);}
  }
  return {...payload,id:call.id};
 }));return new Response(JSON.stringify(Array.isArray(body)?results:results[0]),{status:200,headers:{'content-type':'application/json'}});
};
const observed=await (await originalFetch('http://127.0.0.1:18570',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'eth_getBlockByNumber',params:['latest',false]})})).json();
const pin=fs.existsSync(out+'/deployed-fork-pin.json')?read(out+'/deployed-fork-pin.json'):{blockNumber:String(BigInt(observed.result.number)),blockHash:observed.result.hash};
if(pin.chainId&&pin.chainId!==46630||pin.releaseId&&pin.releaseId!==state.releaseId)throw Error('Fork pin release drift');
fs.writeFileSync(out+'/deployed-fork-pin.json',JSON.stringify({chainId:46630,releaseId:state.releaseId,...pin},null,2));
const proxy=await createPinnedRpcProxy({upstreamUrl:endpoint,expectedChainId:46630,...pin});
const stock=b.assets.find(a=>a.id===m.params.assetUid).values.stockToken;
const env={...process.env,TG_LIVE_VAULT:b.bindings.protocolFeeVault,TG_LIVE_ALLOCATION:b.bindings.allocationManager,TG_LIVE_MARKET:m.id,TG_LIVE_GAUGE:m.gauge,TG_LIVE_TOKEN:m.token,TG_LIVE_STOCK:stock,TG_LIVE_BOB:state.wallets.bob,TG_LIVE_DAVE:state.wallets.dave,TG_LIVE_HOLDER:state.wallets[m.role],TG_LIVE_DISTRIBUTOR:m.distributor};
try{
 const child=spawn(process.execPath,['tools/run-forge.mjs','test','--match-contract','CurrentReleasePublicStateTest','--fork-url',proxy.url,'--fork-block-number',pin.blockNumber,'-vv'],{env,stdio:'inherit'});
 process.exitCode=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('exit',code=>resolve(code??1));});
}finally{fs.writeFileSync(out+'/deployed-fork-rpc-stats.json',JSON.stringify(stats,null,2));await proxy.close();globalThis.fetch=originalFetch;}
