import {TickerGardenV1Client,type GlobalFlowSeriesResponse} from './generated/read-api.ts';
import {validateGlobalSeries} from './globalSeries.ts';
import {candleVolume} from './candleTable.ts';
export function mountGlobalSeries(element:HTMLElement,baseUrl:string|null,chain:number){
 let data:GlobalFlowSeriesResponse|null=null,controller:AbortController|null=null,generation=0;
 const status=document.createElement('p');status.setAttribute('role','status');const label=document.createElement('label');label.textContent='Asset group ';const select=document.createElement('select');select.setAttribute('aria-label','Time series asset group');select.style.maxWidth='100%';label.append(select);
 const list=document.createElement('div');list.style.overflow='auto';list.style.maxHeight='600px';list.tabIndex=0;list.setAttribute('role','region');list.setAttribute('aria-label','Hourly execution volumes, scroll for all columns');
 const refresh=document.createElement('button');refresh.type='button';refresh.textContent='Refresh time series';element.append(status,label,list,refresh);element.style.minWidth='0';element.style.overflowWrap='anywhere';
 const clear=()=>{data=null;select.replaceChildren();label.hidden=true;list.replaceChildren();};
 const render=()=>{
  list.replaceChildren();if(!data)return;const selected=select.value;
  const first=data.points[0]!.groups.find(g=>g.assetUid+':'+g.quoteAsset===selected);if(!first)return;
  const table=document.createElement('table');table.style.borderCollapse='collapse';const caption=table.createCaption();caption.textContent=`${first.binding==='unbound'?'No STOCK binding':'STOCK ID '+first.assetUid} · Quote ${first.quoteAsset}. Internal conversions are included in total volume.`;
  const head=table.createTHead().insertRow();for(const title of ['Hour (UTC)','Quote volume','Internal Quote volume','Executions','Internal executions','Observed fees / taxes by asset','Unknown-fee executions']){const th=document.createElement('th');th.scope='col';th.textContent=title;head.append(th);}
  const body=table.createTBody();for(const p of data.points){const g=p.groups.find(g=>g.assetUid+':'+g.quoteAsset===selected)!;const row=body.insertRow();const time=document.createElement('th');time.scope='row';time.textContent=new Date(p.timestamp*1000).toISOString().slice(0,16).replace('T',' ');row.append(time);for(const text of [candleVolume(g.quoteVolumeRaw,g.quoteDecimals),candleVolume(g.internalQuoteVolumeRaw,g.quoteDecimals),String(g.tradeCount),String(g.internalTradeCount),g.fees.length?g.fees.map(f=>`${f.asset}: ${candleVolume(f.feeRaw,f.decimals)} fees / ${candleVolume(f.taxRaw,f.decimals)} taxes`).join(' · '):g.tradeCount?'No fee observations':'No executions',String(g.unknownFeeTradeCount)])row.insertCell().textContent=text;}
  for(const cell of table.querySelectorAll('th,td')){(cell as HTMLElement).style.padding='8px';(cell as HTMLElement).style.whiteSpace='nowrap';(cell as HTMLElement).style.textAlign='left';}list.append(table);
 };
 const load=async()=>{
  const selected=select.value;
  const own=++generation;controller?.abort();const abort=new AbortController();controller=abort;clear();if(!baseUrl){status.textContent='Time series unavailable. The data service is not configured.';return;}
  const to=Math.floor(Date.now()/3600000)*3600-3600,from=to-86400;const timer=setTimeout(()=>abort.abort(),10000);status.textContent='Loading verified hourly flows…';
  try{const api=new TickerGardenV1Client(baseUrl,(input,init)=>fetch(input,{...init,signal:abort.signal}));const raw=await api.getGlobalFlowSeries({interval:'1h',from:String(from),to:String(to)});const next=validateGlobalSeries(raw,chain,from,to);if(own!==generation)return;if(abort.signal.aborted)throw new Error('Timeout');data=next;
   for(const g of data.points[0]!.groups){const option=document.createElement('option');option.value=g.assetUid+':'+g.quoteAsset;option.textContent=`${g.binding==='unbound'?'Unbound':g.assetUid.slice(0,8)+'…'+g.assetUid.slice(-6)} / Quote ${g.quoteAsset.slice(0,8)}…${g.quoteAsset.slice(-6)}`;select.append(option);}if([...select.options].some(option=>option.value===selected))select.value=selected;label.hidden=select.options.length===0;status.textContent=select.options.length?`24 completed hours · Snapshot block ${data.coverage.projectionNumber} (${data.coverage.projectionHash}). Core Quote amounts, not reserves or USD values.`:'No markets in this verified 24-hour series.';render();
  }catch{if(own===generation){clear();status.textContent='Time series unavailable or incomplete. Try refreshing later.';}}
  finally{clearTimeout(timer);if(own===generation)controller=null;}
 };
 select.addEventListener('change',render);refresh.addEventListener('click',()=>void load());void load();return{refresh:load,stop(){generation++;controller?.abort();controller=null;clear();status.textContent='Statistics paused or unavailable. Waiting for a verified snapshot.';}};
}
