import type {Address,Hash} from 'viem';
type Rpc=(method:string,params:readonly unknown[])=>Promise<unknown>;
export type NetworkRecovery={state:'pending'|'unobserved'|'nonce_consumed'|'unavailable';nonce?:number};
/** A missing hash is never evidence of failure. A finalized consumed nonce cannot execute again. */
export async function inspectPendingNetwork(account:Address,hash:Hash,nonce:number|undefined,chainId:number,rpcs:readonly Rpc[]):Promise<NetworkRecovery>{
 const observations=await Promise.all(rpcs.map(async source=>{
  const rpc:Rpc=async(method,params)=>{let timer:ReturnType<typeof setTimeout>|undefined;try{return await Promise.race([source(method,params),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error('RPC timeout')),8000);})]);}finally{if(timer)clearTimeout(timer);}};
  try{
   if(Number(await rpc('eth_chainId',[]))!==chainId)return null;
   const tx=await rpc('eth_getTransactionByHash',[hash]) as {hash?:string;from?:string;nonce?:string}|null;
   if(tx){if(tx.hash?.toLowerCase()!==hash.toLowerCase()||tx.from?.toLowerCase()!==account.toLowerCase()||!/^0x[0-9a-f]+$/i.test(tx.nonce??''))return null;const n=Number(tx.nonce);if(!Number.isSafeInteger(n))return null;return {found:true,nonce:n,count:0};}
   const raw=await rpc('eth_getTransactionCount',[account,'finalized']);
   if(typeof raw!=='string'||!/^0x[0-9a-f]+$/i.test(raw))return null;const count=Number(raw);if(!Number.isSafeInteger(count))return null;
   return {found:false,nonce:undefined,count};
  }catch{return null;}
 }));
 const found=observations.find(o=>o?.found);
 if(found)return {state:'pending',nonce:found.nonce};
 if(observations.some(o=>!o))return {state:'unavailable',nonce};
 if(nonce!==undefined&&observations.length>0&&observations.every(o=>o!.count>nonce))return {state:'nonce_consumed',nonce};
 return {state:'unobserved',nonce};
}
