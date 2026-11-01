import {AsyncLocalStorage} from 'node:async_hooks';
export type DisplayTrigger={kind:'event'|'request';id:string;transactionHash?:string};
type EventScope={transactionHash:string;blockNumber:bigint;blockHash:string};
type Context={trigger:DisplayTrigger;event?:EventScope;calls:number;expiresAt:number};
const context=new AsyncLocalStorage<Context>();
export const DISPLAY_RPC_LIMIT=128;
export const currentDisplayTrigger=()=>context.getStore()?.trigger;
export function withDisplayTrigger<T>(trigger:DisplayTrigger,run:()=>T):T{
 if(!trigger.id.trim())throw Error('Display trigger identity required');
 return context.run({trigger,calls:0,expiresAt:Date.now()+30_000},run);
}
/** Bound exactly once after resolving the concrete event from the durable inbox. */
export function bindDisplayEvent(event:EventScope){
 const scope=context.getStore();if(!scope||scope.event)throw Error('Display event scope cannot be rebound');
 if(!/^0x[0-9a-f]{64}$/i.test(event.transactionHash)||!/^0x[0-9a-f]{64}$/i.test(event.blockHash)||event.blockNumber<0n)throw Error('Invalid display event scope');
 scope.event={...event};
}
/** Enforced on every physical attempt, including retries, before budget/network access. */
export function displayRpcFetch(fetcher:typeof fetch):typeof fetch{
 return async(input,init)=>{
  const scope=context.getStore(),event=scope?.event;
  if(!scope||!event)throw Error('Display RPC requires a concrete bounded event or request');
  if(Date.now()>scope.expiresAt)throw Error('Display RPC event deadline exceeded');
  const body=JSON.parse(String(init?.body??'{}')) as {method?:string;params?:unknown[]};
  const params=body.params??[],tag=params[1];
  const pinned=tag===`0x${event.blockNumber.toString(16)}`||(typeof tag==='object'&&tag!==null&&(tag as {blockHash?:string}).blockHash===event.blockHash&&(tag as {requireCanonical?:boolean}).requireCanonical===true);
  const allowed=!Array.isArray(body)&&(
   (body.method==='eth_chainId'&&params.length===0)||
   (body.method==='eth_getBlockByNumber'&&params[0]===`0x${event.blockNumber.toString(16)}`&&params[1]===false)||
   (body.method==='eth_getTransactionReceipt'&&params.length===1&&params[0]===event.transactionHash)||
   (['eth_call','eth_getCode','eth_getBalance'].includes(body.method??'')&&params.length===2&&pinned)
  );
  if(!allowed)throw Error('Display RPC outside event scope is forbidden');
  if(++scope.calls>DISPLAY_RPC_LIMIT)throw Error('Display RPC event budget exceeded');
  return fetcher(input,init);
 };
}
