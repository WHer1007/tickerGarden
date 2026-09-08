import type {Hash,TransactionReceipt} from 'viem';
/** Poll only the submitted transaction; never fetch full blocks for replacement detection. */
export async function directReceipt(read:(hash:Hash)=>Promise<TransactionReceipt>,hash:Hash,timeout=30_000,interval=3_000):Promise<TransactionReceipt>{
 const timedOut=()=>{const e=new Error('Receipt is not yet available; keep this transaction pending and query it again.');e.name='WaitForTransactionReceiptTimeoutError';return e;};
 const until=Date.now()+timeout;
 while(Date.now()<until){
  let timer:ReturnType<typeof setTimeout>|undefined;
  try{return await Promise.race([read(hash),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(timedOut()),Math.max(0,until-Date.now()));})]);}catch(e){if(!(e instanceof Error)||e.name!=='TransactionReceiptNotFoundError')throw e;}finally{if(timer)clearTimeout(timer);}
  await new Promise(r=>setTimeout(r,Math.min(interval,Math.max(0,until-Date.now()))));
 }
 const error=new Error('Receipt is not yet available; keep this transaction pending and query it again.');error.name='WaitForTransactionReceiptTimeoutError';throw error;
}
