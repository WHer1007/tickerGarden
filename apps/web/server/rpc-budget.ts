/** Private coordination only; the browser never receives the token or permit. */
export async function acquireRpcPermit(fetcher:typeof fetch,env:Readonly<Record<string,string|undefined>>,url:string,tier:'interactive'|'realtime'|'background'='interactive'):Promise<()=>Promise<void>>{
 if(env.TG_RPC_CONTROL_ENABLED!=='true')return async()=>{};
 try{
 const endpoint=new URL('/v1/internal/rpc-budget',env.TG_RPC_BUDGET_URL??env.VITE_V1_READ_API_URL);
 if(endpoint.protocol!=='https:'||endpoint.username||endpoint.password)throw Error('Invalid RPC budget endpoint');
 if(!env.TG_RPC_BUDGET_TOKEN||env.TG_RPC_BUDGET_TOKEN.length<32)throw Error('RPC budget authentication unavailable');
 const host=new URL(url).hostname,provider=host.endsWith('.quiknode.pro')?'quicknode':host.includes('alchemy')?'alchemy':'other';
 const control=(body:unknown)=>fetcher(endpoint,{method:'POST',headers:{authorization:`Bearer ${env.TG_RPC_BUDGET_TOKEN}`,'content-type':'application/json'},body:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(1500)});
 const r=await control({action:'acquire',provider,tier});if(!r.ok)throw Object.assign(Error('RPC capacity is busy'),{name:'RpcBudgetBusy'});
 const b=await r.json() as {id?:string};if(!b.id||!/^[0-9a-f-]{36}$/.test(b.id))throw Error('Invalid RPC permit');
 return async()=>{await control({action:'release',id:b.id}).catch(()=>undefined);};
 }catch(error){throw Object.assign(error instanceof Error?error:new Error('RPC coordination unavailable'),{name:'RpcBudgetBusy'});}
}
export async function budgetedRpcFetch(fetcher:typeof fetch,env:Readonly<Record<string,string|undefined>>,url:string,init:RequestInit,tier:'interactive'|'realtime'|'background'='interactive'):Promise<Response>{
 const release=await acquireRpcPermit(fetcher,env,url,tier);
 try{const result=await fetcher(url,init);return new Response(await boundedBody(result,2*1024*1024),{status:result.status,statusText:result.statusText,headers:result.headers});}
 finally{await release();}
}

async function boundedBody(response:Response,limit:number):Promise<ArrayBuffer>{
 if(Number(response.headers.get('content-length')??0)>limit){await response.body?.cancel();throw Error('RPC response exceeds size limit');}
 const reader=response.body?.getReader();if(!reader)return new ArrayBuffer(0);
 const chunks:Uint8Array[]=[];let size=0;
 try{while(true){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>limit){await reader.cancel();throw Error('RPC response exceeds size limit');}chunks.push(part.value);}}finally{reader.releaseLock();}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}return bytes.buffer;
}
