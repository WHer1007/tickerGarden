import {rpcAttemptContext} from './attempt.ts';
import {AsyncLocalStorage} from 'node:async_hooks';
import type {Pool} from 'pg';
import {createDatabasePool} from '../../db/src/pool.ts';
import {RpcControlStore,RpcBudgetBusy,digest,type RpcTier,type RpcBudget} from './store.ts';
import type {RpcTransportOptions} from '../../chain/src/index.ts';
const tiers=new AsyncLocalStorage<RpcTier>();
export const withRpcTier=<T>(tier:RpcTier,run:()=>T):T=>tiers.run(tier,run);
export function providerName(url:string){const host=new URL(url).hostname;return host.endsWith('.quiknode.pro')?'quicknode':host.includes('alchemy')?'alchemy':'other';}
export function usage(service:string,fields:Record<string,unknown>){try{console.info(JSON.stringify({...fields,event:'rpc_usage',service,time:new Date().toISOString()}));}catch{}}
export function readBudgets(env:Readonly<Record<string,string|undefined>>):Record<string,RpcBudget>|undefined{
 if(env.TG_RPC_CONTROL_ENABLED!=='true')return undefined;
 if(!((env.TG_ENVIRONMENT==='production'&&env.TG_CHAIN_ID==='4663')||(env.TG_ENVIRONMENT==='test'&&env.TG_CHAIN_ID==='46630')))throw Error('RPC budgets require explicit environment and chain identity');
 const parsed=JSON.parse(env.TG_RPC_BUDGETS_JSON??'null') as Record<string,RpcBudget>|null;
 if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw Error('RPC control requires provider budgets');
 for(const b of Object.values(parsed))if(!b||[b.rps,b.burst,b.backgroundConcurrency,b.nonInteractiveConcurrency].some(v=>!Number.isSafeInteger(v)||v<1)||!Number.isSafeInteger(b.interactiveReserve)||b.interactiveReserve<1||b.interactiveReserve>=b.burst||b.backgroundConcurrency>b.nonInteractiveConcurrency)throw Error('Invalid RPC budget');
 return parsed;
}
export function rpcRuntimeOptions(env:Readonly<Record<string,string|undefined>>,service:string,tier:RpcTier):Pick<RpcTransportOptions,'fetch'|'observe'|'sharedReads'>{
 const budgets=readBudgets(env);
 // Never borrow a connection held by the calling worker transaction/listener.
 // The extra one-connection pool must be included in the deployment DB budget.
 let controlPool:Pool|undefined;
 const control=()=>controlPool??=createDatabasePool(env.TG_RPC_CONTROL_DATABASE_URL??env.TG_PIPELINE_DATABASE_URL??env.TG_READ_DATABASE_URL??'',{max:1,connectionTimeoutMillis:1000},{role:'rpc-control',env}).pool;
 const store=budgets?new RpcControlStore(control,env.TG_DATABASE_SCHEMA):undefined;
 const scope=[env.TG_ENVIRONMENT,env.TG_CHAIN_ID].join(':');
 let lastPrune=0;
 const fetcher:typeof fetch=async(input,init)=>{
  const endpoint=String(input),provider=providerName(endpoint),request=JSON.parse(String(init?.body??'{}')) as {method?:string};
  const method=request.method??'unknown',started=performance.now(),flow=tiers.getStore()??tier;
  let release:(()=>Promise<void>)|undefined,networkCalls=0,responseBytes=0,outcome='failed';
  try{
   if(store){const budget=budgets![provider];if(!budget)throw Error('RPC provider budget missing');const deadline=Date.now()+(flow==='background'?5000:flow==='realtime'?1500:0);
    while(true){try{release=(await store.acquire(`${scope}:${provider}`,flow,budget)).release;break;}catch(e){if(!(e instanceof RpcBudgetBusy)||Date.now()>=deadline)throw e;await new Promise(r=>setTimeout(r,60+Math.random()*40));}}}
   if(init?.signal?.aborted)throw new RpcBudgetBusy();
   networkCalls=1;
   const r=await fetch(input,init);const raw=await boundedBody(r,5*1024*1024);responseBytes=raw.byteLength;
   let rpcError=false;try{rpcError=!!JSON.parse(Buffer.from(raw).toString()).error;}catch{rpcError=true;}
   outcome=r.ok&&!rpcError?'succeeded':'failed';
   return new Response(raw,{status:r.status,statusText:r.statusText,headers:r.headers});
  }catch(error){if(networkCalls===0||error instanceof RpcBudgetBusy){outcome='budget_denied';throw new RpcBudgetBusy();}throw error;}
  finally{
   usage(service,{provider,method,flow,networkCalls,responseBytes,requestBytes:networkCalls?Buffer.byteLength(String(init?.body??'')):0,outcome,durationMs:Math.round(performance.now()-started),transport:'http',...rpcAttemptContext.getStore()});
   await release?.().catch(()=>usage(service,{provider,method,flow,networkCalls:0,outcome:'lease_release_failed'}));
   if(store&&Date.now()-lastPrune>60000){lastPrune=Date.now();void store.prune().catch(()=>usage(service,{networkCalls:0,outcome:'prune_failed'}));}
  }
 };
 return {fetch:fetcher,observe:metric=>usage(service,{...metric,eventKind:metric.event,networkCalls:0,flow:tiers.getStore()??tier}),...(store?{sharedReads:{
  share:(endpoint,key,run,ttl)=>store.share(`${scope}:${digest(endpoint)}`,key,run,ttl),
  findScan:(endpoint,filter)=>store.findScan(`${scope}:${digest(endpoint)}`,filter),
  saveScan:(endpoint,filter,hash,value)=>store.saveScan(`${scope}:${digest(endpoint)}`,filter,hash,value),
  get:(endpoint:string,key:string)=>store.get(`${scope}:${digest(endpoint)}`,key),
  put:(endpoint:string,key:string,value:unknown,ttl:number)=>store.put(`${scope}:${digest(endpoint)}`,key,value,ttl),
 }}:{})};
}

async function boundedBody(response:Response,limit:number):Promise<ArrayBuffer>{
 if(Number(response.headers.get('content-length')??0)>limit){await response.body?.cancel();throw Error('RPC response exceeds size limit');}
 const reader=response.body?.getReader();if(!reader)return new ArrayBuffer(0);
 const chunks:Uint8Array[]=[];let size=0;
 try{while(true){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>limit){await reader.cancel();throw Error('RPC response exceeds size limit');}chunks.push(part.value);}}finally{reader.releaseLock();}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}return bytes.buffer;
}
