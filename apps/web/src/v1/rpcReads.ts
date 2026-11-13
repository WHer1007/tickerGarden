import type {Transport} from 'viem';

type ReadRequest={method:string;params?:readonly unknown[]};
type RequestFn=(request:ReadRequest,options?:unknown)=>Promise<unknown>;

function shareable(request:ReadRequest):boolean {
 const params=request.params??[];
 if(request.method==='eth_call'){
  const tx=params[0] as Record<string,unknown>|undefined;
  // Sender-dependent simulations and state overrides retain separate requests.
  return params.length<=2&&!!tx&&Object.keys(tx).every(key=>['to','data','input'].includes(key));
 }
 if(request.method==='eth_getBlockByNumber')return params[1]===false;
 return ['eth_chainId','eth_blockNumber','eth_getCode','eth_getBalance','eth_getTransactionByHash','eth_getTransactionReceipt'].includes(request.method);
}

/** One in-flight request per exact read and client. No completed balance, receipt,
 * null, nonce, gas or canonical-header cache. Every subsequent read is fresh. */
export function createRpcReadCoalescer(read:RequestFn){
 const pending=new Map<string,Promise<unknown>>();
 return {
  clear:()=>pending.clear(),
  request(request:ReadRequest,options?:unknown):Promise<unknown>{
   // Custom cancellation/retry policies remain owned by their individual caller.
   const defaultOptions=options===undefined||!!options&&typeof options==='object'&&Object.keys(options).length===1&&(options as {dedupe?:unknown}).dedupe===true;
   if(!defaultOptions||!shareable(request))return read(request,options);
   const key=JSON.stringify([request.method,request.params??[]]);
   const prior=pending.get(key);if(prior)return prior;
   const result=Promise.resolve().then(()=>read(request,options));
   if(pending.size<256){
    pending.set(key,result);
    void result.finally(()=>{if(pending.get(key)===result)pending.delete(key);}).catch(()=>{});
   }
   return result;
  },
 };
}

export function createPageReadTransport(base:Transport){
 let clear=()=>{};
 const transport:Transport=options=>{
  const inner=base(options);
  const shared=createRpcReadCoalescer(inner.request as RequestFn);
  clear=shared.clear;
  return {...inner,request:shared.request as typeof inner.request};
 };
 return {transport,clear:()=>clear()};
}
