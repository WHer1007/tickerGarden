import {TickerGardenV1Client,type TokenDetailChart} from './generated/read-api.ts';
import {validateTokenDetail} from './tokenDetail.ts';
import {validateCandles} from './candles.ts';
import type {DetailIdentity,DetailPeriod} from './tokenDetail.ts';

const windows={'1H':[3600,60,'1m'],'12H':[43200,300,'5m'],'1D':[86400,900,'15m']} as const;
export function detailChartWindow(period:DetailPeriod,asOf:number){
 if(!Number.isSafeInteger(asOf)||asOf<86400)throw Error('Finalized chart time unavailable');
 const[duration,interval,apiInterval]=windows[period],to=Math.floor(asOf/interval)*interval;
 return {from:to-duration,to,interval,apiInterval};
}
export async function loadDetailChart(base:string,chain:number,id:DetailIdentity,period:DetailPeriod,asOf:number,signal:AbortSignal,transport:typeof fetch=fetch,confirmed=false):Promise<TokenDetailChart>{
 const{from,to,interval,apiInterval}=detailChartWindow(period,asOf);
 const api=new TickerGardenV1Client(base,(input,init)=>transport(input,{...init,signal}));
 if(confirmed){const value=validateTokenDetail(await api.getTokenDetail({marketId:id.marketId,period,section:'chart'}),chain,id,period);if(value.chart)return value.chart;const initial=creationReceiptChart(value,period);if(initial)return initial;throw Error('Confirmed chart unavailable');}
 const raw=await api.getMarketCandles({marketId:id.marketId,from:String(from),to:String(to),interval:apiInterval});
 const value=validateCandles(raw,chain,{marketId:id.marketId,memeAsset:id.memeToken,quoteAsset:id.quoteAsset,quoteDecimals:id.quoteDecimals},from,to,interval);
 return {from,to,interval,points:value.series.candles.map(c=>{const n=c.close?BigInt(c.close.numerator)*10n**36n/BigInt(c.close.denominator):null;return {timestamp:c.timestamp,price:n===null?null:`${n/10n**36n}.${(n%10n**36n).toString().padStart(36,'0')}`};})};
}

/** Initial chart from the backend-verified creation receipt, including its open
 * interval. It is replaced by indexed history, never padded with invented prices. */
export function creationReceiptChart(data:import('./generated/read-api.ts').TokenDetailResponse,period:DetailPeriod):TokenDetailChart|null{
 if(data.period===period&&data.chart)return data.chart;
 if(data.confirmation!=='confirmed'||!data.sources.trades||data.trades===null)return null;
 const [duration,interval]=windows[period],asOf=data.sources.trades.asOf;
 const to=(Math.floor(asOf/interval)+1)*interval,from=to-duration;
 const points:Array<{timestamp:number;price:string|null}>=Array.from({length:duration/interval},(_,i)=>({timestamp:from+i*interval,price:null}));
 // Only actual executions from the verified receipt contribute a point.
 for(const trade of [...data.trades].reverse()){
  if(trade.timestamp<from||trade.timestamp>asOf)continue;
  const point=points[Math.floor((trade.timestamp-from)/interval)];if(point)point.price=trade.price;
 }
 return {from,to,interval,points};
}
