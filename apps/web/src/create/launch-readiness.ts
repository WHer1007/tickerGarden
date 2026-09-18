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

export async function waitForLaunchData(base:string,marketId:`0x${string}`,token:string,signal:AbortSignal):Promise<void>{
 const api=new TickerGardenV1Client(base,(input,init)=>fetch(input,{...init,cache:'no-store',signal:AbortSignal.any([signal,AbortSignal.timeout(10000)])}));
 while(!signal.aborted){
  try{
   const [page,detail]=await Promise.all([api.getMarketPageBootstrap({marketId}),api.getTokenDetail({marketId,period:'1H'})]);
   if(launchDataReady(page,detail,marketId,token))return;
  }catch{/* Readiness failures never turn a confirmed launch into a failed transaction. */}
  await new Promise<void>(resolve=>{const done=()=>{clearTimeout(timer);signal.removeEventListener('abort',done);resolve();};const timer=setTimeout(done,3000);signal.addEventListener('abort',done,{once:true});});
 }
 signal.throwIfAborted();
}
