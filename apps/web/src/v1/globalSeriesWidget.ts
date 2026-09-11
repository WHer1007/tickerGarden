import {TickerGardenV1Client,type GlobalFlowSeriesResponse} from './generated/read-api.ts';
import {validateGlobalSeries} from './globalSeries.ts';
import {candleVolume} from './candleTable.ts';
import {cachedStatistics} from './statisticsCache.ts';
export function mountGlobalSeries(element:HTMLElement,baseUrl:string|null,chain:number,assetLabel:(address:string)=>string=address=>address==='0x'+'0'.repeat(40)?'ETH':`${address.slice(0,6)}…${address.slice(-4)}`){
 let data:GlobalFlowSeriesResponse|null=null,controller:AbortController|null=null,generation=0;
 const tools=document.createElement('div');tools.className='stats-chart-tools';
 const select=document.createElement('select');select.setAttribute('aria-label','Chart Paired Asset');select.hidden=true;
 const refresh=document.createElement('button');refresh.type='button';refresh.textContent='Retry';refresh.hidden=true;tools.append(select,refresh);
 const status=document.createElement('p');status.className='stats-chart-status';status.setAttribute('role','status');
 const chart=document.createElement('div');chart.className='stats-chart-body';chart.setAttribute('role','region');chart.setAttribute('aria-label','Hourly Trading Volume');
 element.append(tools,chart,status);
 const empty=(message:string,loading=false)=>{const area=document.createElement('div');area.className='stats-chart-empty'+(loading?' is-loading':'');const icon=document.createElement('i');icon.className=loading?'ph ph-circle-notch':'ph ph-chart-bar';icon.setAttribute('aria-hidden','true');const note=document.createElement('span');note.textContent=message;area.append(icon,note);chart.replaceChildren(area);};
 const render=()=>{
  if(!data)return;
  const quote=select.value,groups=data.points[0]!.groups.filter(g=>g.quoteAsset===quote);if(!groups.length){empty('No Trading Data Yet');return;}
  const decimals=groups[0]!.quoteDecimals,label=assetLabel(quote);
  const values=data.points.map(point=>point.groups.filter(g=>g.quoteAsset===quote).reduce((sum,g)=>sum+BigInt(g.quoteVolumeRaw)-BigInt(g.internalQuoteVolumeRaw),0n));
  const max=values.reduce((a,b)=>a>b?a:b,0n),total=values.reduce((a,b)=>a+b,0n);
  if(max===0n){empty('No Trades In This Period');status.textContent=`0 ${label} · External Trading Volume`;return;}
  const bars=document.createElement('div');bars.className='stats-chart-bars';
  values.forEach((amount,i)=>{const bar=document.createElement('div');bar.className='stats-chart-bar';bar.style.height=`${Number(amount*10000n/max)/100}%`;bar.tabIndex=0;const hour=new Date(data!.points[i]!.timestamp*1000).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit',hour12:false});bar.title=`${hour} · ${candleVolume(amount.toString(),decimals)} ${label}`;bar.setAttribute('aria-label',bar.title);bars.append(bar);});
  const axis=document.createElement('div');axis.className='stats-chart-axis';for(const index of [0,6,12,18,23]){const tick=document.createElement('span');tick.textContent=new Date(data.points[index]!.timestamp*1000).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit',hour12:false});axis.append(tick);}
  chart.replaceChildren(bars,axis);status.textContent=`${candleVolume(total.toString(),decimals)} ${label} · External Trading Volume`;
 };
 const load=async(force=false)=>{
  if(controller)return;const selected=select.value,own=++generation,abort=new AbortController();controller=abort;refresh.hidden=true;
  if(!baseUrl){controller=null;empty('Chart Data Is Not Available Yet');return;}
  if(!data)empty('Loading Activity…',true);chart.setAttribute('aria-busy','true');const timer=setTimeout(()=>abort.abort(),10000);
  const to=Math.floor(Date.now()/3600000)*3600-3600,from=to-86400;
  try{
   const next=await cachedStatistics(`${baseUrl}:${chain}:series:${from}:${to}`,async()=>{const api=new TickerGardenV1Client(baseUrl,(input,init)=>fetch(input,{...init,signal:abort.signal}));return validateGlobalSeries(await api.getGlobalFlowSeries({interval:'1h',from:String(from),to:String(to)}),chain,from,to);},force);
   if(own!==generation)return;if(abort.signal.aborted)throw new Error('Timeout');data=next;
   select.replaceChildren();for(const quote of [...new Set(data.points[0]!.groups.map(g=>g.quoteAsset))]){const option=document.createElement('option');option.value=quote;option.textContent=assetLabel(quote);select.append(option);}if([...select.options].some(o=>o.value===selected))select.value=selected;select.hidden=select.options.length<2;render();
  }catch{if(own===generation){data=null;select.hidden=true;empty('Chart Data Is Not Available Yet');status.textContent='';refresh.hidden=false;}}
  finally{clearTimeout(timer);if(own===generation){controller=null;chart.setAttribute('aria-busy','false');}}
 };
 select.addEventListener('change',render);refresh.addEventListener('click',()=>void load(true));void load();
 return{refresh:()=>load(),stop(){generation++;controller?.abort();controller=null;data=null;chart.setAttribute('aria-busy','false');empty('Chart Data Is Not Available Yet');}};
}
