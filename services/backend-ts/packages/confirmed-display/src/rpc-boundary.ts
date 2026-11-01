import {AsyncLocalStorage} from 'node:async_hooks';
export type DisplayTrigger={kind:'event'|'request';id:string};
const context=new AsyncLocalStorage<DisplayTrigger>();
export const currentDisplayTrigger=()=>context.getStore();
export function withDisplayTrigger<T>(trigger:DisplayTrigger,run:()=>T):T{
 if(!trigger.id.trim())throw Error('Display trigger identity required');
 return context.run(trigger,run);
}
/** Enforced before budget acquisition or any network traffic, even on retry paths. */
export function displayRpcFetch(fetcher:typeof fetch):typeof fetch{
 return async(input,init)=>{
  if(!context.getStore())throw Error('Display RPC requires a concrete event or request');
  const body=JSON.parse(String(init?.body??'{}')) as {method?:string};
  if(Array.isArray(body)||body.method==='eth_getLogs'||body.method==='eth_getBlockReceipts')throw Error('Display range scanning is forbidden');
  return fetcher(input,init);
 };
}
