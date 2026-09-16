import type {TokenDetailTrade} from './generated/read-api.ts';
import type {DetailPeriod} from './tokenDetail.ts';
/** Last execution per bucket; untraded buckets are gaps, never synthetic prices. */
export function chartFromTrades(trades:readonly TokenDetailTrade[],period:DetailPeriod,now=Math.floor(Date.now()/1000)){
 const duration={ '1H':3600,'12H':43200,'1D':86400 }[period];
 const interval={ '1H':60,'12H':300,'1D':900 }[period];
 const to=(Math.floor(now/interval)+1)*interval,from=to-duration;
 const latest=new Map<number,TokenDetailTrade>();
 for(const trade of trades){
  if(trade.timestamp<from||trade.timestamp>now||!/^\d+(\.\d+)?$/.test(trade.price)||Number(trade.price)<=0)continue;
  const bucket=Math.floor(trade.timestamp/interval)*interval,old=latest.get(bucket);
  if(!old||old.timestamp<trade.timestamp||(old.timestamp===trade.timestamp&&Number(old.eventKey.split(':').at(-1))<Number(trade.eventKey.split(':').at(-1))))latest.set(bucket,trade);
 }
 return {from,to,interval,points:Array.from({length:duration/interval},(_,i)=>{const timestamp=from+i*interval;return {timestamp,price:latest.get(timestamp)?.price??null};})};
}
