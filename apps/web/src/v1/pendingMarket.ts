import {assertFinalizedSync} from '../runtime/model.ts';
import {TickerGardenApiError,type MarketDetailResponse} from './generated/read-api.ts';

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

export const MARKET_PUBLICATION_PENDING = 'This market is not in the published data yet. The backend is verifying the creation transaction. This page updates automatically.';
export const LAUNCH_CONFIRMED_COPY = 'Created on chain. Your market is being added to the database and will appear automatically. You do not need to launch again.';

// This only requests backend verification. It never sends market fields or
// copies receipt-derived statistics into the page.
const notifications=new Map<string,Promise<boolean>>();
export function notifyLaunchDatabase(hash:string,base:unknown,fetcher:typeof fetch=fetch):Promise<boolean>{
 if(!/^0x[0-9a-f]{64}$/.test(hash)||typeof base!=='string')return Promise.resolve(false);
 let url:URL;try{url=new URL('/v1/launches',base);if(url.protocol!=='https:')return Promise.resolve(false);}catch{return Promise.resolve(false);}
 const key=`${url.origin}:${hash}`;const pending=notifications.get(key);if(pending)return pending;
 const work=(async()=>{for(let attempt=0;attempt<6;attempt++){
  try{const response=await fetcher(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({transactionHash:hash}),signal:AbortSignal.timeout(25000)});
   if(response.ok){const result=await response.json();if(result.status==='confirmed'&&/^0x[0-9a-f]{64}$/.test(result.marketId))return true;}
  }catch{/* The durable WebSocket relay is an independent delivery path. */}
  if(attempt<5)await new Promise(resolve=>setTimeout(resolve,5000));
 }return false;})();
 notifications.set(key,work);void work.finally(()=>notifications.delete(key));return work;
}
