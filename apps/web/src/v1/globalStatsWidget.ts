import {TickerGardenV1Client} from './generated/read-api.ts';
import {validateGlobalStatistics} from './globalStats.ts';
import {candleVolume} from './candleTable.ts';
export function mountGlobalStatistics(element:HTMLElement,baseUrl:string|null,chain:number){
 let generation=0,controller:AbortController|null=null;
 const status=document.createElement('p');status.setAttribute('role','status');const body=document.createElement('div');const refresh=document.createElement('button');refresh.type='button';refresh.textContent='Refresh statistics';element.append(status,body,refresh);
 element.style.minWidth='0';element.style.overflowWrap='anywhere';
 const load=async()=>{
  const own=++generation;controller?.abort();controller=new AbortController();const abort=controller;body.replaceChildren();
  if(!baseUrl){status.textContent='Statistics unavailable. The data service is not configured.';return;}
  const to=Math.floor(Date.now()/3600000)*3600-3600,from=to-86400;status.textContent='Loading verified statistics…';const timer=setTimeout(()=>abort.abort(),10000);
  try{
   const api=new TickerGardenV1Client(baseUrl,(input,init)=>fetch(input,{...init,signal:abort.signal}));const raw=await api.getGlobalStatistics({from:String(from),to:String(to)});const p=validateGlobalStatistics(raw,chain,from,to);if(own!==generation)return;if(abort.signal.aborted)throw new Error('Timeout');
   status.textContent=`${p.marketCount} markets · ${p.registeredStockCount} registered STOCK configurations (including retired) · ${p.boundMarketCount} STOCK-bound markets · ${p.unboundMarketCount} unbound markets. Counts at block ${p.coverage.projectionNumber}.`;
   const details=document.createElement('details');details.open=element.hasAttribute('data-expanded');const summary=document.createElement('summary');summary.textContent='Execution volumes and observed fees by asset';details.append(summary);
   const range=document.createElement('p');range.textContent=`Flows: ${new Date(from*1000).toISOString()} to ${new Date(to*1000).toISOString()} (end excluded). Quote amounts use Curve amounts excluding fees/tax or Pool core deltas. Internal conversions are included and shown separately.`;details.append(range);
   for(const g of p.groups){const article=document.createElement('article');const title=document.createElement('h3');const stock=p.stocks.find(s=>s.assetUid===g.assetUid);title.textContent=stock?`STOCK ${stock.stockToken}`:'No STOCK binding';const volumes=document.createElement('p');volumes.textContent=`Quote ${g.quoteAsset} · ${g.marketCount} markets · ${g.tradeCount} executions · Volume ${candleVolume(g.quoteVolumeRaw,g.quoteDecimals)} · Internal conversions ${candleVolume(g.internalQuoteVolumeRaw,g.quoteDecimals)} (${g.internalTradeCount} executions)`;article.append(title,volumes);
    for(const f of g.fees){const fee=document.createElement('p');fee.textContent=`Fee asset ${f.asset} · Observed fees ${candleVolume(f.feeRaw,f.decimals)} · Observed taxes ${candleVolume(f.taxRaw,f.decimals)}`;article.append(fee);}
    const unknown=document.createElement('p');unknown.textContent=`${g.unknownFeeTradeCount} executions have unavailable fee observations.`;article.append(unknown);details.append(article);
   }
   if(p.groups.length===0){const empty=document.createElement('p');empty.textContent='No markets in this verified snapshot.';details.append(empty);}
   const source=document.createElement('p');source.textContent=`Snapshot ${p.coverage.projectionHash}. Amounts remain in their original assets; no USD valuation or reserve total is inferred.`;details.append(source);body.append(details);
  }catch{if(own===generation){body.replaceChildren();status.textContent='Statistics unavailable or incomplete. Try refreshing later.';}}
  finally{clearTimeout(timer);if(own===generation)controller=null;}
 };
 refresh.addEventListener('click',()=>void load());void load();return{refresh:load,stop(){generation++;controller?.abort();controller=null;body.replaceChildren();status.textContent='Statistics paused or unavailable. Waiting for a verified snapshot.';}};
}
