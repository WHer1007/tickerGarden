import type {MarketPageBootstrap,TokenDetailResponse} from '../v1/generated/read-api.ts';
import {TickerGardenV1Client} from '../v1/readApi.ts';

// Empty activity is valid for a new market; missing sections are not.
export function launchDataReady(page:MarketPageBootstrap, detail:TokenDetailResponse, marketId:string, token:string):boolean {
 const m=page.market;
 return m.marketId===marketId && m.memeToken===token && detail.marketId===marketId && detail.memeToken===token
  && detail.chainId===page.sync.chainId && Boolean(m.identity && m.content && m.display)
  && page.configs.some(c=>c.kind==='quote' && c.id===m.quoteAssetConfigId)
  && detail.statistics?.price!=null && detail.statistics.volume24h!=null
  && detail.statistics.priceUsd!=null && detail.statistics.marketCapUsd!=null
  && detail.holders!=null && detail.chart!=null && detail.trades!=null && detail.fees!=null;
}

export class LaunchDataPendingError extends Error {
 constructor(){super('Your token is created. Its page is still being prepared. We will retry automatically.');this.name='LaunchDataPendingError';}
}
export async function waitForLaunchData(base:string,marketId:`0x${string}`,token:string,signal:AbortSignal,timing:{timeoutMs?:number;retryMs?:number}={}):Promise<void>{
 const deadline=AbortSignal.timeout(timing.timeoutMs??60000);
 const active=AbortSignal.any([signal,deadline]);
 const api=new TickerGardenV1Client(base,(input,init)=>fetch(input,{...init,cache:'no-store',signal:AbortSignal.any([active,AbortSignal.timeout(10000)])}));
 while(!active.aborted){
  try{
   const [page,detail]=await Promise.all([api.getMarketPageBootstrap({marketId}),api.getTokenDetail({marketId,period:'1H'})]);
   if(!active.aborted&&launchDataReady(page,detail,marketId,token))return;
  }catch{/* A confirmed launch stays confirmed while its read model recovers. */}
  if(active.aborted)break;
  await new Promise<void>(resolve=>{const done=()=>{clearTimeout(timer);active.removeEventListener('abort',done);resolve();};const timer=setTimeout(done,timing.retryMs??3000);active.addEventListener('abort',done,{once:true});});
 }
 signal.throwIfAborted();
 throw new LaunchDataPendingError();
}
