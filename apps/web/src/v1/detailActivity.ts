import {TickerGardenV1Client,type TokenDetailResponse} from './generated/read-api.ts';
import {validateTokenDetail,type DetailIdentity} from './tokenDetail.ts';
export function createDetailActivity(base:string,chain:number,id:DetailIdentity,changed:(value:TokenDetailResponse)=>void,transport:typeof fetch=fetch){
 let stopped=false,pending:Promise<boolean>|null=null,controller:AbortController|null=null,lastRead=0,attempt=0;
 let receiptGeneration=0;
 let expected:string|null=null,timer:ReturnType<typeof setTimeout>|undefined;
 const refresh=(force=false):Promise<boolean>=>{
  if(stopped)return Promise.resolve(false);
  if(pending)return pending;
  if(!force&&Date.now()-lastRead<30000)return Promise.resolve(false);
  const abort=new AbortController();controller=abort;const deadline=setTimeout(()=>abort.abort(),12000);
  const api=new TickerGardenV1Client(base,(input,init)=>transport(input,{...init,signal:abort.signal}));
  pending=api.getTokenDetail({marketId:id.marketId,period:'1H',section:'activity'}).then(raw=>{
   const value=validateTokenDetail(raw,chain,id,'1H');if(stopped||abort.signal.aborted)return false;
   lastRead=Date.now();changed(value);
   if(expected&&value.trades?.some(t=>t.txHash===expected)){expected=null;clearTimeout(timer);}
   return true;
  }).catch(()=>false).finally(()=>{clearTimeout(deadline);controller=null;pending=null;});
  return pending;
 };
 const reconcile=async(own:number)=>{
  if(stopped||!expected||own!==receiptGeneration)return;
  await refresh(true);
  if(stopped||!expected||own!==receiptGeneration||++attempt>=12)return;
  timer=setTimeout(()=>{void reconcile(own);},Math.min(30000,2000*2**(attempt-1)));
 };
 return {refresh,seed(){lastRead=Date.now();},receipt(hash:string){if(stopped||expected===hash)return;expected=hash;attempt=0;clearTimeout(timer);void reconcile(++receiptGeneration);},stop(){stopped=true;clearTimeout(timer);controller?.abort();expected=null;}};
}
