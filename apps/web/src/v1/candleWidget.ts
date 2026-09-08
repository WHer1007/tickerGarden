import { candleTable } from "./candleTable.ts";
import { TickerGardenV1Client } from './generated/read-api.ts';
import { candleY, candlePriceLabel, comparePrice, validateCandles, type CandleIdentity } from './candles.ts';

export function mountCandles(element: HTMLElement, baseUrl: string | null, chain: number) {
 let generation=0, controller: AbortController|null=null;
 const status=document.createElement('p');status.setAttribute('role','status');
 const chart=document.createElement('div');element.style.minWidth='0';chart.style.minWidth='0';
 const button=document.createElement('button');button.type='button';button.textContent='Refresh chart';
 element.append(status,chart,button);
 let identity:CandleIdentity|null=null;
 const clear=(message:string)=>{chart.replaceChildren();status.textContent=message;};
 const refresh=async()=>{
  const own=++generation;controller?.abort();const abort=new AbortController();controller=abort;
  clear('Loading completed hourly candles…');
  if(!identity || !baseUrl){controller=null;clear('Load a market to view price history.');return;}
  const id=identity;
  // Leave the most recent hour out; the server must still prove finality.
  const to=Math.floor(Date.now()/3600000)*3600-3600,from=to-24*3600;
  const timeout=setTimeout(()=>abort.abort(),10000);
  try {
   const api=new TickerGardenV1Client(baseUrl,(input,init)=>fetch(input,{...init,signal:abort.signal}));
   const raw=await api.getMarketCandles({marketId:id.marketId,interval:'1h',from:String(from),to:String(to)});
   const data=validateCandles(raw,chain,id,from,to);
   if(own!==generation || abort.signal.aborted)return;
   const active=data.series.candles.filter(c=>c.low!==null && c.high!==null);
   if(!active.length){clear('No trades in this verified time range.');chart.append(candleTable(data));return;}
   const prices=active.flatMap(c=>[c.low!,c.high!]).sort(comparePrice),low=prices[0]!,high=prices.at(-1)!;
   const ns='http://www.w3.org/2000/svg';const svg=document.createElementNS(ns,'svg');svg.setAttribute('viewBox','0 0 720 250');svg.style.width='100%';svg.style.minWidth='600px';svg.setAttribute('role','img');svg.setAttribute('aria-label','24 completed hourly candles, Quote per Meme. Empty hours have no candle.');
   const text=(x:number,y:number,label:string)=>{const t=document.createElementNS(ns,'text');t.setAttribute('x',String(x));t.setAttribute('y',String(y));t.setAttribute('fill','currentColor');t.setAttribute('font-size','12');t.textContent=label;svg.append(t);};
   data.series.candles.forEach((c,i)=>{
    if(!c.open || !c.close || !c.high || !c.low)return;
    const x=90+i*25,color=comparePrice(c.close,c.open)>=0?'#8ac926':'#e76f51';
    const line=document.createElementNS(ns,'line');line.setAttribute('x1',String(x));line.setAttribute('x2',String(x));line.setAttribute('y1',String(candleY(c.high,low,high)));line.setAttribute('y2',String(candleY(c.low,low,high)));line.setAttribute('stroke',color);svg.append(line);
    const rect=document.createElementNS(ns,'rect');const y1=candleY(c.open,low,high),y2=candleY(c.close,low,high);rect.setAttribute('x',String(x-7));rect.setAttribute('y',String(Math.min(y1,y2)));rect.setAttribute('width','14');rect.setAttribute('height',String(Math.max(2,Math.abs(y2-y1))));rect.setAttribute('fill',color);
    const title=document.createElementNS(ns,'title');title.textContent=`${new Date(c.timestamp*1000).toISOString()} · O ${candlePriceLabel(c.open)} H ${candlePriceLabel(c.high)} L ${candlePriceLabel(c.low)} C ${candlePriceLabel(c.close)} · ${c.tradeCount} executions (${c.internalTradeCount} internal)`;rect.append(title);svg.append(rect);
   });
   text(0,20,candlePriceLabel(high));text(0,210,candlePriceLabel(low));text(80,240,new Date(from*1000).toISOString().slice(5,16)+' UTC');text(480,240,new Date(to*1000).toISOString().slice(5,16)+' UTC');const viewport=document.createElement('div');viewport.style.overflowX='auto';viewport.tabIndex=0;viewport.setAttribute('role','region');viewport.setAttribute('aria-label','Hourly price chart, scroll horizontally on small screens');viewport.append(svg);chart.replaceChildren(viewport,candleTable(data));
   status.textContent='Quote per Meme · Core execution prices · Internal conversions included · Display only. Open the hourly data table for prices and volumes.';
  } catch {if(own===generation)clear('Price history unavailable or not yet fully indexed. Try refreshing later.');}
  finally{clearTimeout(timeout);if(own===generation)controller=null;}
 };
 button.addEventListener('click',()=>void refresh());
 clear('Load a market to view price history.');
 return {setMarket(id:CandleIdentity|null){identity=id;void refresh();},stop(){generation++;controller?.abort();controller=null;identity=null;clear('Price history paused. Load a market to resume.');}};
}
