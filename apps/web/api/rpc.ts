import {webRequestId,reportWebError} from '../server/diagnostics.ts';
const ALLOWED_METHODS = new Set([
  'eth_blockNumber',
  'eth_call',
  'eth_chainId',
  'eth_estimateGas',
  'eth_feeHistory',
  'eth_gasPrice',
  'eth_getBalance',
  'eth_getBlockByNumber',
  'eth_getCode',
  'eth_getLogs',
  'eth_getTransactionByHash',
  'eth_getTransactionCount',
  'eth_getTransactionReceipt',
  'eth_maxPriorityFeePerGas',
]);

const MAX_REQUEST_BYTES = 64 * 1024;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_BATCH_SIZE = 20;

type RpcEnvironment = Readonly<Record<string, string | undefined>>;

type Call={jsonrpc:'2.0';id:string|number|null;method:string;params?:readonly unknown[]};
type Target={address:string;topics:readonly string[]};
type ProxyState={pending:Map<string,Promise<unknown>>;buckets:Map<string,{at:number;count:number}>;active:number;fallbackChains:Map<string,{expiresAt:number;promise:Promise<boolean>}>;primaryCooldownUntil:number};
const states=new WeakMap<typeof fetch,Map<string,ProxyState>>();
function stateFor(fetcher:typeof fetch,key:string):ProxyState{
 let entries=states.get(fetcher);if(!entries){entries=new Map();states.set(fetcher,entries);}
 let state=entries.get(key);if(!state){state={pending:new Map(),buckets:new Map(),active:0,fallbackChains:new Map(),primaryCooldownUntil:0};entries.set(key,state);}return state;
}
function admit(state:ProxyState,ip:string,cost:number):boolean{
 const now=Date.now();for(const [key,b]of state.buckets)if(now-b.at>=10000)state.buckets.delete(key);
 if(state.buckets.size>=2048&&!state.buckets.has(ip))return false;
 for(const [key,limit]of [[ip,120],['*',600]] as const){const b=state.buckets.get(key)??{at:now,count:0};if(b.count+cost>limit)return false;}
 for(const key of [ip,'*']){const b=state.buckets.get(key)??{at:now,count:0};b.count+=cost;state.buckets.set(key,b);}return true;
}
async function share<T>(state:ProxyState,key:string,read:()=>Promise<T>):Promise<T>{
 const existing=state.pending.get(key);if(existing)return existing as Promise<T>;
 if(state.active>=32)throw Error('capacity');
 state.active++;const pending=read();state.pending.set(key,pending);
 try{return await pending;}finally{state.active--;state.pending.delete(key);}
}
const ADDRESS=/^0x[0-9a-fA-F]{40}$/,HASH=/^0x[0-9a-fA-F]{64}$/;
const tag=(v:unknown)=>typeof v==='string'&&(/^(latest|pending|safe|finalized|earliest)$/.test(v)||/^0x[0-9a-fA-F]{1,16}$/.test(v));
function targetAddress(call:Call):string|undefined{
 const p=call.params??[];
 if(['eth_call','eth_estimateGas'].includes(call.method))return String((p[0] as Record<string,unknown>).to).toLowerCase();
 if(call.method==='eth_getCode')return String(p[0]).toLowerCase();
 if(call.method==='eth_getLogs')return String((p[0] as Record<string,unknown>).address).toLowerCase();
 return undefined;
}
function validReadScope(call:Call):boolean{
 const p=call.params??[];
 if(['eth_blockNumber','eth_chainId','eth_gasPrice','eth_maxPriorityFeePerGas'].includes(call.method))return p.length===0;
 if(['eth_getBalance','eth_getTransactionCount','eth_getCode'].includes(call.method))return p.length===2&&typeof p[0]==='string'&&ADDRESS.test(p[0])&&tag(p[1]);
 if(['eth_getTransactionByHash','eth_getTransactionReceipt'].includes(call.method))return p.length===1&&typeof p[0]==='string'&&HASH.test(p[0]);
 if(call.method==='eth_getBlockByNumber')return p.length===2&&tag(p[0])&&p[1]===false;
 if(call.method==='eth_feeHistory')return p.length===3&&typeof p[0]==='string'&&/^0x[0-9a-f]{1,3}$/i.test(p[0])&&BigInt(p[0])<=100n&&tag(p[1])&&Array.isArray(p[2])&&p[2].length<=10&&p[2].every(v=>typeof v==='number'&&v>=0&&v<=100);
 if(['eth_call','eth_estimateGas'].includes(call.method)){
  const tx=p[0] as Record<string,unknown>;
  return p.length>=1&&p.length<=2&&(p.length===1||tag(p[1]))&&!!tx&&typeof tx==='object'&&!Array.isArray(tx)
   &&Object.keys(tx).every(k=>['from','to','data','input','value','gas','gasPrice','maxFeePerGas','maxPriorityFeePerGas','type','nonce','accessList'].includes(k))
   &&typeof tx.to==='string'&&ADDRESS.test(tx.to)&&(tx.from===undefined||typeof tx.from==='string'&&ADDRESS.test(tx.from))
   &&[tx.data,tx.input].every(v=>v===undefined||typeof v==='string'&&/^0x(?:[0-9a-fA-F]{2})*$/.test(v)&&v.length<=32770);
 }
 if(call.method!=='eth_getLogs')return false;
 const filter=p[0];if(p.length!==1||!filter||typeof filter!=='object'||Array.isArray(filter))return false;
 const f=filter as Record<string,unknown>;
 if(Object.keys(f).some(k=>!['address','fromBlock','toBlock','topics'].includes(k))||typeof f.address!=='string'||!ADDRESS.test(f.address))return false;
 if(!Array.isArray(f.topics)||f.topics.length<1||f.topics.length>4)return false;
 if(!f.topics.every((v,i)=>i>0&&v===null||typeof v==='string'&&HASH.test(v)||Array.isArray(v)&&v.length>0&&v.length<=16&&v.every(t=>typeof t==='string'&&HASH.test(t))))return false;
 if(f.fromBlock==='latest'&&f.toBlock==='latest')return true;
 if(typeof f.fromBlock!=='string'||typeof f.toBlock!=='string'||!/^0x[0-9a-fA-F]{1,16}$/.test(f.fromBlock)||!/^0x[0-9a-fA-F]{1,16}$/.test(f.toBlock))return false;
 return BigInt(f.toBlock)>=BigInt(f.fromBlock)&&BigInt(f.toBlock)-BigInt(f.fromBlock)<=2000n;
}
function logRangeExceedsCap(call:Call,cap:number):boolean{
 if(call.method!=='eth_getLogs')return false;
 const f=call.params?.[0] as {fromBlock?:unknown;toBlock?:unknown}|undefined;
 if(f?.fromBlock==='latest'&&f.toBlock==='latest')return false;
 if(typeof f?.fromBlock!=='string'||typeof f.toBlock!=='string'||!/^0x[0-9a-f]{1,16}$/i.test(f.fromBlock)||!/^0x[0-9a-f]{1,16}$/i.test(f.toBlock))return false;
 return BigInt(f.toBlock)-BigInt(f.fromBlock)+1n>BigInt(cap);
}
export async function proxyReadRpc(request:Request,environment:RpcEnvironment,fetcher:typeof fetch=fetch):Promise<Response>{
 const requestId=webRequestId();
 const headers={'cache-control':'no-store','content-type':'application/json','x-request-id':requestId};
 if(request.method!=='POST')return json({error:'method_not_allowed'},405,headers);
 if(!sameOrigin(request))return json({error:'origin_not_allowed'},403,headers);
 const declared=Number(request.headers.get('content-length')??'0');
 if(!Number.isFinite(declared)||declared<0||declared>MAX_REQUEST_BYTES)return json({error:'request_too_large'},413,headers);
 const raw=await request.text();if(new TextEncoder().encode(raw).byteLength>MAX_REQUEST_BYTES)return json({error:'request_too_large'},413,headers);
 let payload:unknown;try{payload=JSON.parse(raw);}catch{return json({error:'invalid_json_rpc'},400,headers);}
 const calls=Array.isArray(payload)?payload:[payload];
 if(!calls.length||calls.length>MAX_BATCH_SIZE||!calls.every(validPayload)||!uniqueIds(calls))return json({error:'invalid_json_rpc'},400,headers);
 if(calls.some(c=>!ALLOWED_METHODS.has(c.method)))return json({error:'rpc_method_not_allowed'},403,headers);
 if(calls.some(c=>!validReadScope(c)))return json({error:'invalid_json_rpc'},400,headers);
 const upstream=rpcUrl(environment.TG_WEB_RPC_URL);if(!upstream)return json({error:'rpc_upstream_unavailable'},503,headers);
 const fallbackConfigured=environment.TG_WEB_RPC_FALLBACK_URL!==undefined;
 const fallback=fallbackConfigured?rpcUrl(environment.TG_WEB_RPC_FALLBACK_URL):null;
 if(fallbackConfigured&&!fallback)return json({error:'rpc_upstream_unavailable'},503,headers);
 const capValue=environment.TG_WEB_RPC_LOG_MAX_BLOCKS;
 const logCap=capValue===undefined?null:/^[1-9][0-9]*$/.test(capValue)&&Number.isSafeInteger(Number(capValue))?Number(capValue):null;
 if(capValue!==undefined&&logCap===null)return json({error:'rpc_upstream_unavailable'},503,headers);
 const state=stateFor(fetcher,upstream+':'+(fallback??'')+':'+(environment.VITE_V1_READ_API_URL??'')+':'+(environment.VITE_V1_CHAIN_ID??''));
 // Vercel overwrites x-vercel-forwarded-for. Never trust caller-selected X-Forwarded-For.
 const ip=request.headers.get('x-vercel-forwarded-for')?.split(',')[0]?.trim()??'local';
 if(!admit(state,ip,calls.length))return json({error:'rpc_rate_limited'},429,{...headers,'retry-after':'10'});
 async function targets(addresses:string[]):Promise<Map<string,Target>>{
  if(!addresses.length)return new Map();
  const base=rpcUrl(environment.VITE_V1_READ_API_URL);if(!base)throw Error('scope unavailable');
  const unique=[...new Set(addresses)].sort();
  return share(state,'scope:'+unique.join(','),async()=>{
   const url=new URL('/v1/rpc-scope',base);url.searchParams.set('addresses',unique.join(','));
   const r=await fetcher(url,{redirect:'error',signal:AbortSignal.timeout(4000)});if(!r.ok)throw Error('scope unavailable');
   const data=await r.json();if(data.chainId!==Number(environment.VITE_V1_CHAIN_ID)||!Array.isArray(data.targets))throw Error('scope mismatch');
   return new Map(data.targets.filter((v:Target)=>unique.includes(v.address)&&Array.isArray(v.topics)).map((v:Target)=>[v.address,v]));
  });
 }
 try{
  const scope=await targets(calls.flatMap(c=>{const a=targetAddress(c);return a?[a]:[];}));
  for(const c of calls){const a=targetAddress(c);if(a&&!scope.has(a))return json({error:'rpc_target_not_allowed'},403,headers);
   if(c.method==='eth_getLogs'){const topics=(c.params![0] as {topics:unknown[]}).topics[0];const selected=Array.isArray(topics)?topics:[topics];if(!selected.every(t=>scope.get(a!)!.topics.includes(String(t).toLowerCase())))return json({error:'rpc_event_not_allowed'},403,headers);}
  }
  if(logCap!==null&&!fallback&&calls.some(c=>logRangeExceedsCap(c,logCap)))return json({error:'rpc_upstream_unavailable'},502,headers);
  async function fallbackChainMatches():Promise<boolean>{
   if(!fallback)return false;
   const cached=state.fallbackChains.get(fallback);if(cached&&cached.expiresAt>Date.now())return cached.promise;
   const promise=fetcher(fallback,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'eth_chainId',params:[]}),redirect:'error',signal:AbortSignal.timeout(4000)}).then(async r=>{
    if(!r.ok)return false;const text=await r.text();if(new TextEncoder().encode(text).byteLength>1024)return false;
    const b=JSON.parse(text);return b.jsonrpc==='2.0'&&b.id===1&&typeof b.result==='string'&&/^0x[0-9a-f]+$/i.test(b.result)&&BigInt(b.result)===BigInt(environment.VITE_V1_CHAIN_ID??'0');
   }).catch(()=>false);
   state.fallbackChains.set(fallback,{expiresAt:Date.now()+30000,promise});
   return promise;
  }
  const results=await Promise.all(calls.map(async c=>{
   const forceFallback=logCap!==null&&logRangeExceedsCap(c,logCap);
   const key=JSON.stringify([c.method,c.params??[]]);
   const body=await share(state,key,async()=>{
    const send=async(url:string)=>{
     let r:Response;try{r=await fetcher(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({...c,id:1}),redirect:'error',signal:AbortSignal.timeout(4000)});}catch{return {retryable:true,error:new Error('upstream unavailable')};}
     if(!r.ok){const retryable=[401,403,408,429].includes(r.status)||r.status>=500;if(!retryable)throw Error('upstream unavailable');return {retryable,error:new Error('upstream unavailable')};}
     let b:any;try{const text=await r.text();if(new TextEncoder().encode(text).byteLength>MAX_RESPONSE_BYTES)throw Error('response too large');b=JSON.parse(text);}catch{return {retryable:true,error:new Error('invalid response')};}
     if(b.jsonrpc!=='2.0'||b.id!==1||(!('result' in b)&&!b.error))return {retryable:true,error:new Error('invalid response')};
     const code=(b.error as {code?:unknown}|undefined)?.code;
     return {body:b,retryable:code===-32603||code===-32005};
    };
    if(forceFallback){if(!(await fallbackChainMatches()))throw Error('fallback unavailable');const secondary=await send(fallback!);if(secondary.retryable)throw Error('fallback unavailable');return secondary.body;}
    if(fallback&&state.primaryCooldownUntil>Date.now()){
     if(!(await fallbackChainMatches()))throw Error('fallback unavailable');const secondary=await send(fallback);if(secondary.retryable)throw Error('fallback unavailable');return secondary.body;
    }
    const primary=await send(upstream);
    if(primary.retryable){state.primaryCooldownUntil=Date.now()+30000;if(!fallback)throw primary.error??Error('upstream unavailable');if(!(await fallbackChainMatches()))throw Error('fallback unavailable');const secondary=await send(fallback);if(secondary.retryable)throw Error('fallback unavailable');return secondary.body;}
    state.primaryCooldownUntil=0;
    return primary.body;
   }) as {jsonrpc:string;id:number;result?:unknown;error?:unknown};
   if(['eth_getTransactionByHash','eth_getTransactionReceipt'].includes(c.method)&&body.result){
    const r=body.result as {to?:string;logs?:{address:string}[]};const addresses=[r.to,...(r.logs??[]).map(l=>l.address)].filter((a):a is string=>typeof a==='string'&&ADDRESS.test(a)).map(a=>a.toLowerCase());
    if(!(await targets(addresses.slice(0,60))).size)return {jsonrpc:'2.0',id:c.id,error:{code:-32602,message:'Transaction is outside project scope'}};
   }
   if(body.error){const error=body.error as {code?:unknown;data?:unknown};const revertData=typeof error.data==='string'&&/^0x[0-9a-f]*$/i.test(error.data)?error.data:undefined;return {jsonrpc:'2.0',id:c.id,error:{...(typeof error.code==='number'?{code:error.code}:{}),message:'RPC request failed',...(revertData===undefined?{}:{data:revertData})}};}
   return {...body,id:c.id};
  }));
  return json(Array.isArray(payload)?results:results[0],200,headers);
 }catch(error){reportWebError('rpc_upstream_unavailable',error,{requestId,status:502});return json({error:'rpc_upstream_unavailable'},502,headers);}
}

function validPayload(value: unknown): value is { readonly jsonrpc: '2.0'; readonly id: string | number | null; readonly method: string; readonly params?: readonly unknown[] } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  const id = item.id;
  return item.jsonrpc === '2.0'
    && typeof item.method === 'string'
    // JSON-RPC 2.0 permits params to be omitted. Viem does this for reads such
    // as eth_blockNumber and eth_chainId, including inside HTTP batches.
    && (item.params === undefined || Array.isArray(item.params))
    && (id === null || typeof id === 'string' || (typeof id === 'number' && Number.isSafeInteger(id)));
}

function uniqueIds(calls: readonly { readonly id: string | number | null }[]): boolean {
  const ids = new Set<string>();
  for (const call of calls) {
    if (call.id === null) return false;
    const key = `${typeof call.id}:${String(call.id)}`;
    if (ids.has(key)) return false;
    ids.add(key);
  }
  return true;
}

function sameOrigin(request: Request): boolean {
  const origin = request.headers.get('origin');
  if (!origin) return false;
  try { return new URL(origin).origin === new URL(request.url).origin; } catch { return false; }
}

function rpcUrl(value: string | undefined): string | null {
  try {
    const url = new URL(value ?? '');
    return url.protocol === 'https:' && !url.username && !url.password && !url.hash ? url.toString() : null;
  } catch { return null; }
}

function json(value: unknown, status: number, headers: Record<string, string>): Response {
  return new Response(JSON.stringify(value), { status, headers });
}

export default {
  fetch(request: Request): Promise<Response> {
    return proxyReadRpc(request, process.env);
  },
};
