import {TickerGardenV1Client,type TokenDetailChart} from './generated/read-api.ts';
import {validateCandles} from './candles.ts';
import type {DetailIdentity,DetailPeriod} from './tokenDetail.ts';

const windows={'1H':[3600,60,'1m'],'12H':[43200,300,'5m'],'1D':[86400,900,'15m']} as const;
export function detailChartWindow(period:DetailPeriod,asOf:number){
 if(!Number.isSafeInteger(asOf)||asOf<86400)throw Error('Finalized chart time unavailable');
 const[duration,interval,apiInterval]=windows[period],to=Math.floor(asOf/interval)*interval;
 return {from:to-duration,to,interval,apiInterval};
}
export async function loadDetailChart(base:string,chain:number,id:DetailIdentity,period:DetailPeriod,asOf:number,signal:AbortSignal,transport:typeof fetch=fetch):Promise<TokenDetailChart>{
 const{from,to,interval,apiInterval}=detailChartWindow(period,asOf);
 const api=new TickerGardenV1Client(base,(input,init)=>transport(input,{...init,signal}));
 const raw=await api.getMarketCandles({marketId:id.marketId,from:String(from),to:String(to),interval:apiInterval});
 const value=validateCandles(raw,chain,{marketId:id.marketId,memeAsset:id.memeToken,quoteAsset:id.quoteAsset,quoteDecimals:id.quoteDecimals},from,to,interval);
 return {from,to,interval,points:value.series.candles.map(c=>{const n=c.close?BigInt(c.close.numerator)*10n**36n/BigInt(c.close.denominator):null;return {timestamp:c.timestamp,price:n===null?null:`${n/10n**36n}.${(n%10n**36n).toString().padStart(36,'0')}`};})};
}
