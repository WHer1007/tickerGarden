import {assertFinalizedSync} from '../runtime/model.ts';
import {TickerGardenApiError,type MarketDetailResponse} from './generated/read-api.ts';
import {EVM_GATEWAY_ORIGIN,scopedEvmUrl} from './evmTransport.ts';

// Absence in a valid publication is recoverable; transport and identity errors
// must still fail visibly. Never construct a market from a receipt or RPC here.
export async function readPublishedMarket(
 read:()=>Promise<MarketDetailResponse>, marketId:`0x${string}`, revision:string,
):Promise<MarketDetailResponse|null>{
 let detail:MarketDetailResponse;
 try{detail=await read();}
 catch(error){
  if(!(error instanceof TickerGardenApiError)||error.status!==404||error.body.error!=='market_not_found')throw error;
  if(!('sync' in error.body)||!error.body.sync)throw error;
  assertFinalizedSync(error.body.sync,revision,'missing market');
  return null;
 }
 assertFinalizedSync(detail.sync,revision,'market detail');
 if(detail.market.marketId!==marketId)throw new Error('Read API returned a different market identity');
 return detail;
}

export const MARKET_PUBLICATION_PENDING = 'Market details are being prepared. This page will update automatically. You do not need to launch again.';

export function marketIdentityPending(market:Pick<MarketDetailResponse['market'],'identity'>):boolean {
 return !market.identity;
}
export const LAUNCH_CONFIRMED_COPY = 'Your token is live.';

// This only requests backend verification. It never sends market fields or
// copies receipt-derived statistics into the page.
const notifications=new Map<string,Promise<boolean>>();
export type LaunchNotificationTarget = Readonly<{chainId:number;pipelineUrl:string}>;
export function launchNotificationTarget(env:Record<string,unknown>,chainId:number):LaunchNotificationTarget|undefined {
 const pipelineUrl=chainId===56?env.VITE_BSC_PIPELINE_URL:env.VITE_V1_PIPELINE_URL;
 return typeof pipelineUrl==='string'&&[56,4663,46630,421614].includes(chainId)?{chainId,pipelineUrl}:undefined;
}
export function notifyLaunchDatabase(hash:string,target:LaunchNotificationTarget|undefined,fetcher:typeof fetch=fetch,mode:'background'|'prepare'='background'):Promise<boolean>{
 if(!/^0x[0-9a-f]{64}$/.test(hash)||!target||![56,4663,46630,421614].includes(target.chainId))return Promise.resolve(false);
 let url:URL;
 try{
  const base=new URL(target.pipelineUrl);
  if(base.protocol!=='https:'||base.username||base.password||base.hash) return Promise.resolve(false);
  // BSC notifications use the explicit gateway; never inherit a direct RH Pipeline.
  if(target.chainId===56&&base.origin!==EVM_GATEWAY_ORIGIN)return Promise.resolve(false);
  if(base.searchParams.size&&(![...base.searchParams.keys()].every(k=>k==='chainId')||base.searchParams.getAll('chainId').length!==1||base.searchParams.get('chainId')!==String(target.chainId)))return Promise.resolve(false);
  url=new URL(scopedEvmUrl(new URL('/v1/launches',base),target.chainId));
 }catch{return Promise.resolve(false);}
 const key=`${target.chainId}:${url.href}:${hash}:${mode}`;const pending=notifications.get(key);if(pending)return pending;
 const attempts=mode==='prepare'?1:6;
 const work=(async()=>{for(let attempt=0;attempt<attempts;attempt++){
  try{const response=await fetcher(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({transactionHash:hash}),signal:AbortSignal.timeout(mode==='prepare'?8000:25000)});
   const selected=response.headers.get('x-chain-id');
   if((response.ok&&url.origin===EVM_GATEWAY_ORIGIN&&selected!==String(target.chainId))||(selected!==null&&selected!==String(target.chainId)))return false;
   if(response.ok){const result=await response.json();if(result.chainId!==undefined&&result.chainId!==target.chainId)return false;if(result.transactionHash!==undefined&&result.transactionHash!==hash)return false;if(result.status==='confirmed'&&/^0x[0-9a-f]{64}$/.test(result.marketId))return true;}
   // Configuration and validation failures cannot be recovered by repeating the same request.
   if(response.status>=400&&response.status<500&&![408,429].includes(response.status))return false;
  }catch{/* The durable WebSocket relay is an independent delivery path. */}
  if(attempt<attempts-1)await new Promise(resolve=>setTimeout(resolve,5000));
 }return false;})();
 notifications.set(key,work);void work.finally(()=>notifications.delete(key));return work;
}
