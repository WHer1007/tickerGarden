import {watchMarketChanges,type DetailRegion} from './marketChanges.ts';
import {createDetailActivity} from './detailActivity.ts';
import {feeUsdValue,formatFeeUsd} from './feeQuoteValue.ts';
import {compactPrice} from "../ui/compact-price.ts";
import {creationReceiptChart,detailChartWindow,loadDetailChart} from './detailChart.ts';
import {formatTradePrice} from './tradePricing.ts';
import {mergeRecentTrades} from './recentTrades.ts';
import type {TokenDetailTrade,TokenDetailFee} from './generated/read-api.ts';
import {marketCapUsd,type MarketOverview} from './marketOverview.ts';
import {TickerGardenV1Client,TickerGardenApiError,type TokenDetailResponse,type TokenDetailChart} from './generated/read-api.ts';
import {validateTokenDetail,displayDecimal,scaledDecimal,feeRows,type DetailIdentity,type DetailPeriod,type FeeConfig} from './tokenDetail.ts';
import {candleVolume} from './candleTable.ts';
export function mountTokenDetail(root:HTMLElement,base:string|null,chain:number,explorer:string){
 const q=<T extends HTMLElement=HTMLElement>(s:string)=>root.querySelector<T>(s)!;
 const text=(s:string,v:string)=>root.querySelectorAll<HTMLElement>(s).forEach(e=>{if(e.textContent!==v)e.textContent=v;});
 let id:DetailIdentity|null=null,period:DetailPeriod='1H',data:TokenDetailResponse|null=null,fees:FeeConfig|null=null,controller:AbortController|null=null,generation=0,expiry:ReturnType<typeof setTimeout>|undefined,tradeLimit=20,holderLimit=20;
 let changes:ReturnType<typeof watchMarketChanges>|null=null,partialAbort:AbortController|null=null;
 let activity:TokenDetailResponse|null=null,activityLoader:ReturnType<typeof createDetailActivity>|null=null;
 let state:'loading'|'ready'|'pending'|'error'='loading';
 let activeKey='';
 let overview:MarketOverview={};
 let tradePrice:string|null=null;
 let feeTotals:readonly TokenDetailFee[]|null=null,feeTotalsAt=0;
 let recentTrades:TokenDetailTrade[]=[];
 let chartTrades:TokenDetailTrade[]=[];
 let chartData:TokenDetailChart|null=null,chartState:'loading'|'ready'|'error'|'pending'='loading',chartGeneration=0,chartRequest:AbortController|null=null,chartKey='';
 const chartCache=new Map<string,{value:TokenDetailChart;until:number}>();
 const currentChart=()=>chartData;
 const chartKeyFor=(identity:DetailIdentity,chosen:DetailPeriod,asOf:number)=>`${identity.marketId}:${chosen}:${detailChartWindow(chosen,asOf).to}`;
 const chartTime=()=>Math.max(overview.asOf??0,...(data?Object.values(data.sources).map(source=>source.asOf):[0]));
 const chartStateText=()=>chartState==='pending'?'Waiting for market data':chartState==='loading'?'Loading Chart…':'Could Not Load Chart. Try Again.';
 const cache=new Map<string,{data:TokenDetailResponse;until:number;refreshAt:number}>();
 const stateText=()=>state==='loading'?'Loading Data…':state==='pending'?'Statistics Not Ready':state==='error'?'Could Not Load Data. Try Refresh.':'Some Statistics Are Not Ready';
 const amount=(raw:string,d:number)=>displayDecimal(candleVolume(raw,d),6);
 const empty=(tbody:HTMLTableSectionElement,message:string,cols:number)=>{tbody.replaceChildren();const td=tbody.insertRow().insertCell();td.colSpan=cols;td.className='detail-empty-cell';const box=document.createElement('div');box.className='detail-activity-empty';box.setAttribute('role','status');const icon=document.createElement('i');icon.className=cols===6?'ph ph-arrows-left-right':'ph ph-users';icon.setAttribute('aria-hidden','true');const label=document.createElement('span');label.textContent=message;box.append(icon,label);td.append(box);};
 const sourceLabel=()=>{if(!data)return stateText();if(data.confirmation==='confirmed')return '';const entries=Object.entries({...data.sources,...activity?.sources}).filter(([k])=>['statistics','chart','trades','holders','fees'].includes(k));if(!entries.length)return 'Statistics Not Ready';const providers=[...new Set(entries.map(([,s])=>s.provider==='dune'?'Dune':'Indexer'))];const oldest=Math.min(...entries.map(([,s])=>s.asOf));q('[data-detail-source]').title=entries.map(([k,s])=>`${k}: ${s.provider} · ${new Date(s.asOf*1000).toLocaleString()} · block ${s.blockNumber}`).join(' | ');return `${state==='loading'?'Refreshing · ':state==='error'||state==='pending'?'Refresh Failed · Showing Cached Data · ':''}${providers.join(' + ')} · Updated ${new Date(oldest*1000).toLocaleTimeString()} · Historical data`;};
 let drawnChartKey='';
 const draw=(force=false)=>{
  const canvas=q<HTMLCanvasElement>('[data-detail-chart] canvas'),ctx=canvas.getContext('2d');if(!ctx)return;
  const box=canvas.parentElement!.getBoundingClientRect(),w=Math.max(250,box.width),h=Math.max(180,box.height),dpr=window.devicePixelRatio||1;
  const key=JSON.stringify([id?.marketId,id?.quoteSymbol,period,chartState,chartData,w,h,dpr]);if(!force&&key===drawnChartKey)return;drawnChartKey=key;canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr);canvas.style.width=`${w}px`;canvas.style.height=`${h}px`;ctx.scale(dpr,dpr);ctx.clearRect(0,0,w,h);
  const chart=currentChart(),active=chart?.points.filter(p=>p.price!==null)??[];ctx.font='12px "Inter Variable"' ;ctx.fillStyle='#718092';
  if(!chart||!active.length){ctx.textAlign='center';ctx.fillText(chart?'No Trades In This Period':chartStateText(),w/2,h/2);canvas.setAttribute('aria-label',chart?'No Trades In This Period':chartStateText());return;}
  const prices=active.map(p=>scaledDecimal(p.price!)),min=prices.reduce((a,b)=>a<b?a:b),max=prices.reduce((a,b)=>a>b?a:b),padding=min===max?(min/20n||1n):(max-min)/10n,low=min>padding?min-padding:0n,high=max+padding,left=76,right=w-8,top=12,bottom=h-30;
  const x=(ts:number)=>left+(ts-chart.from)/(chart.to-chart.from)*(right-left);
  const y=(p:string)=>high===low?(top+bottom)/2:bottom-Number((scaledDecimal(p)-low)*10000n/(high-low))/10000*(bottom-top);
  ctx.textAlign='right';for(let i=0;i<5;i++){const yy=top+(bottom-top)*i/4,n=high-(high-low)*BigInt(i)/4n;ctx.strokeStyle='#e9eee7';ctx.beginPath();ctx.moveTo(left,yy);ctx.lineTo(right,yy);ctx.stroke();ctx.fillStyle='#718092';ctx.fillText(formatTradePrice(`${n/10n**36n}.${(n%10n**36n).toString().padStart(36,'0')}`),left-8,yy+4);}
  const color=scaledDecimal(active.at(-1)!.price!)>=scaledDecimal(active[0]!.price!)?'#17834b':'#b83f3f';
  // Connect observed executions chronologically; empty buckets add no price points.
  let segment:Array<{timestamp:number;price:string}>=[];
  const paint=()=>{if(!segment.length)return;ctx.beginPath();segment.forEach((p,i)=>i?ctx.lineTo(x(p.timestamp),y(p.price)):ctx.moveTo(x(p.timestamp),y(p.price)));ctx.strokeStyle=color;ctx.lineWidth=1.8;ctx.stroke();if(segment.length===1){ctx.beginPath();ctx.arc(x(segment[0]!.timestamp),y(segment[0]!.price),2.5,0,Math.PI*2);ctx.fillStyle=color;ctx.fill();}else{ctx.lineTo(x(segment.at(-1)!.timestamp),bottom);ctx.lineTo(x(segment[0]!.timestamp),bottom);ctx.closePath();const gradient=ctx.createLinearGradient(0,top,0,bottom);gradient.addColorStop(0,color+'30');gradient.addColorStop(1,color+'03');ctx.fillStyle=gradient;ctx.fill();}segment=[];};
  for(const p of chart.points){if(p.price!==null)segment.push({timestamp:p.timestamp,price:p.price});}paint();
  ctx.fillStyle='#718092';ctx.textAlign='left';const label=(ts:number)=>new Date(ts*1000).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit',hourCycle:'h23'});ctx.fillText(label(chart.from),left,h-8);ctx.textAlign='right';ctx.fillText(label(chart.to),right,h-8);canvas.setAttribute('aria-label',`${period} ${id?.quoteSymbol} price history; ${active.length} observed intervals. Lines connect recorded trades.`);
 };
 let renderedFeesKey='',renderedTradesKey='',renderedHoldersKey='';
 const renderFees=()=>{
  const key=JSON.stringify([id?.marketId,fees,activity?.fees??data?.fees,overview.usd,overview.price,data?.statistics?.price,activity?.sources.fees??data?.sources.fees,fees?null:state]);if(key===renderedFeesKey)return;renderedFeesKey=key;
  const feeData=activity?.fees??data?.fees??null;
  const metrics=q('[data-detail-fee-metrics]'),bar=q('[data-detail-fee-bar]'),rows=q('[data-detail-fee-rows]');metrics.replaceChildren();bar.replaceChildren();rows.replaceChildren();
  if(!fees){metrics.textContent='-';rows.textContent=state==='loading'?'Loading Fee Settings…':'Fee Settings Not Ready';text('[data-detail-fee-status]','-');return;}
  const values=feeRows(fees);metrics.style.gridTemplateColumns=`repeat(${values.filter(row=>row.key!=='holders').length},minmax(0,1fr))`;bar.style.gridTemplateColumns=values.map(r=>`${r.percent??1}fr`).join(' ');
  for(const v of values){const cell=document.createElement('div'),strong=document.createElement('strong'),pct=document.createElement('span'),label=document.createElement('small');strong.textContent=v.percent===null?'-':String(v.percent);pct.textContent='%';strong.append(pct);label.textContent=v.label;cell.append(strong,label);cell.dataset.feeRecipient=v.key;cell.classList.toggle('is-zero',v.percent===0);if(v.key==='holders'){const creator=metrics.querySelector('[data-fee-recipient="creator"]');if(creator){const share=document.createElement('span');share.className='fee-holder-share';share.textContent=`Holders ${v.percent===null?'-':`${v.percent}%`}`;creator.append(share);}}else{metrics.append(cell);}const part=document.createElement('span');part.title=`${v.label} ${v.percent??'-'}%`;part.hidden=v.percent===0;bar.append(part);
   const row=document.createElement('div'),percent=document.createElement('strong'),name=document.createElement('b'),note=document.createElement('span'),total=document.createElement('p');percent.textContent=v.percent===null?'-':`${v.percent}%`;name.textContent=v.label;note.textContent=v.note;const amounts=feeData?.filter(f=>f.recipient===v.key)??[];const usdValue=feeData&&id?feeUsdValue(amounts,id.quoteAsset,id.memeToken,id.quoteDecimals,overview.price??data?.statistics?.price,overview.usd):null;total.textContent=formatFeeUsd(usdValue);total.title=usdValue===null?'USD valuation unavailable':`$${usdValue} · Estimated at current prices`;row.append(percent,name,note,total);row.classList.toggle('is-zero',v.percent===0);rows.append(row);
  }
  rows.querySelectorAll('.is-zero').forEach(row=>rows.append(row));
  text('[data-detail-fee-status]',`${fees.phase===0?'Curve':!fees.stakingEnabled?'Pool':fees.active===null?'Stake status unavailable':fees.active?'Staking active':'No active stake'} · Holder sharing ${fees.holders?'on':'off'}`);
  text('[data-detail-fee-note]','');
  text('[data-detail-fee-rules]',[fees.baseFeeBps===undefined?'':`Base Trading Fee: ${fees.baseFeeBps/100}%`,fees.taxBps>0?`Additional Creator Tax: ${fees.taxBps/100}%`:'',fees.lpFeePips===undefined?'':`LP Fee: ${fees.lpFeePips/10000}%`,data?.sources.fees?`Updated ${new Date((activity?.sources.fees??data.sources.fees).asOf*1000).toLocaleString()}`:feeData?`Cumulative Allocations · Finalized Snapshot`:'Earnings Data Pending',feeData?'Estimated USD value at current prices':''].filter(Boolean).join(' · '));
 };
 const renderChartChange=()=>{
  const active=currentChart()?.points.filter(p=>p.price!==null)??[];let change='-';if(active.length>1){const first=scaledDecimal(active[0]!.price!),last=scaledDecimal(active.at(-1)!.price!);const bps=(last-first)*10000n/first;change=`${bps>=0n?'+':'−'}${(bps<0n?-bps:bps)/100n}.${((bps<0n?-bps:bps)%100n).toString().padStart(2,'0')}% (${period})`;q('[data-detail-change]').classList.toggle('ref-negative',bps<0n);}text('[data-detail-change]',change);
 };
 const render=()=>{
  const stats=data?.statistics,h=overview.holders?{...overview.holders,totalSupplyRaw:overview.supply??'0'}:data?.holders;
  const exactPrice=(data?.sources.statistics?.asOf??0)>(overview.asOf??0)?stats?.price??overview.price:overview.price??stats?.price; text('[data-detail-price]',compactPrice(exactPrice));q('[data-detail-price]').title=exactPrice??'';text('[data-detail-price-unit]',id?`Price (${id.quoteSymbol})`:'Price');
  const volume=overview.volume24h??stats?.volume24h;
  text('[data-detail-volume]',volume!==null&&volume!==undefined&&id?`${displayDecimal(volume,6)} ${id.quoteSymbol}`:'-');
  text('[data-detail-holders]',h?h.count.toLocaleString():'-');const supply=(data?.sources.holders?.asOf??0)>(overview.asOf??0)?data?.holders?.totalSupplyRaw??overview.supply:overview.supply??data?.holders?.totalSupplyRaw;text('[data-detail-circulating]',supply!==undefined?amount(supply,18):'-');
  if(overview.maximum!==undefined)text('[data-detail-supply]',amount(overview.maximum,18));
  const cap=marketCapUsd(supply,exactPrice??undefined,overview.usd);text('[data-detail-cap]',cap!==null?`$${displayDecimal(cap,2)}`:'-');
  renderChartChange();
  const visibleTrades=activity?.trades??data?.trades??[];
  const tradesKey=JSON.stringify([id?.marketId,activity?.trades??data?.trades,tradeLimit,activity?.trades||data?.trades?null:state]);
  if(tradesKey!==renderedTradesKey){renderedTradesKey=tradesKey;
  const trades=q<HTMLTableSectionElement>('[data-detail-trades-body]');empty(trades,activity?.trades||data?.trades?'No Trades Yet':state==='loading'?'Loading Trades…':state==='error'?'Could Not Load Trades':'No Trade Data Yet',6);
  if(visibleTrades.length){trades.replaceChildren();for(const t of visibleTrades.slice(0,tradeLimit)){const row=trades.insertRow();row.title=t.classification==='unclassified'?'Contract caller; wallet identity unverified':'Internal reward conversion';const values=[new Date(t.timestamp*1000).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}),t.side==='buy'?'Buy':'Sell',formatTradePrice(t.price),amount(t.memeRaw,18),amount(t.quoteRaw,id!.quoteDecimals),t.actor?`${t.actor.slice(0,6)}…${t.actor.slice(-4)}`:'-'];values.forEach((v,i)=>{const c=row.insertCell();c.textContent=v;if(i===1)c.className=t.side;if(i===0){const link=document.createElement('a');link.href=`${explorer}/tx/${t.txHash}`;link.target='_blank';link.rel='noopener noreferrer';link.textContent=v;c.replaceChildren(link);}});}}
  }
  const holdersKey=JSON.stringify([id?.marketId,h,holderLimit,h?null:state]);
  if(holdersKey!==renderedHoldersKey){renderedHoldersKey=holdersKey;
  const holders=q<HTMLTableSectionElement>('[data-detail-holders-body]');empty(holders,h?'No Holders To Show':state==='loading'?'Loading Holders…':state==='error'?'Could Not Load Holders':'No Holder Data Yet',3);if(h?.items.length){holders.replaceChildren();for(const v of h.items.slice(0,holderLimit)){const row=holders.insertRow(),bp=BigInt(h.totalSupplyRaw)?BigInt(v.balanceRaw)*10000n/BigInt(h.totalSupplyRaw):0n;for(const s of [`${v.account.slice(0,6)}…${v.account.slice(-4)}`,amount(v.balanceRaw,18),`${bp/100n}.${(bp%100n).toString().padStart(2,'0')}%`])row.insertCell().textContent=s;row.title=v.account;}}
  }
  q('[data-detail-more-trades]').hidden=!id;q('[data-detail-more-holders]').hidden=!id;text('[data-detail-source]',sourceLabel());renderFees();
  for(const el of root.querySelectorAll<HTMLElement>('[data-detail-price],[data-detail-volume],[data-detail-holders],[data-detail-circulating],[data-detail-cap],[data-detail-change]')){el.classList.toggle('detail-loading',state==='loading'&&el.textContent==='-');el.title=el.textContent==='-'?stateText():'';}
  q('[data-detail-source]').setAttribute('role','status');
  draw();
 };
 const refreshChart=async(force=false)=>{
  if(!id||!base)return;
  const identity=id,chosen=period,asOf=chartTime();
  const initial=data&&data.period===chosen?creationReceiptChart(data,chosen):null;
  if(initial){chartGeneration++;chartRequest?.abort();chartRequest=null;chartData=initial;chartState='ready';renderChartChange();draw();return;}
  if(!asOf){chartState='loading';chartData=null;draw();return;}
  if(Date.now()/1000-asOf>1200||asOf>Date.now()/1000+30){chartState='error';chartData=null;renderChartChange();draw();return;}
  const key=chartKeyFor(identity,chosen,asOf);
  if(chartRequest&&chartKey===key&&!chartRequest.signal.aborted)return;
  const own=++chartGeneration;chartRequest?.abort();chartRequest=null;chartKey=key;
  const cached=chartCache.get(key);
  if(!force&&cached&&cached.until>Date.now()){chartData=cached.value;chartState='ready';renderChartChange();draw();return;}
  chartData=cached&&cached.until>Date.now()?cached.value:null;chartState='loading';renderChartChange();draw();
  const abort=new AbortController();chartRequest=abort;const timer=setTimeout(()=>abort.abort(),12000);
  try{
   const next=await loadDetailChart(base,chain,identity,chosen,asOf,abort.signal,fetch,data?.confirmation==='confirmed');
   if(own!==chartGeneration||abort.signal.aborted||id!==identity||period!==chosen)return;
   chartCache.set(key,{value:next,until:Math.min(Date.now()+15000,(asOf+1200)*1000)});
   if(chartCache.size>12)chartCache.delete(chartCache.keys().next().value!);
   chartData=next;chartState='ready';renderChartChange();draw();
  }catch{if(own===chartGeneration){chartState=data?.confirmation==='confirmed'?'pending':'error';renderChartChange();draw();}}
  finally{clearTimeout(timer);if(own===chartGeneration)chartRequest=null;}
 };
 // Fetch analytics while the finalized market/configuration bootstrap is in flight.
 // Rendering still waits for the independently validated market identity.
 let prefetchRequest:{marketId:string;abort:AbortController;result:Promise<{value:TokenDetailResponse}|{error:unknown}>}|null=null;
 const prefetch=(marketId:string)=>{
  if(!base||!/^0x[0-9a-f]{64}$/.test(marketId)||prefetchRequest?.marketId===marketId)return;
  prefetchRequest?.abort.abort();
  const abort=new AbortController(),timer=setTimeout(()=>abort.abort(),12000);
  const api=new TickerGardenV1Client(base,(input,init)=>fetch(input,{...init,signal:abort.signal}));
  const result=api.getTokenDetail({marketId:marketId as `0x${string}`,period:'1H'}).then(value=>({value}),error=>({error})).finally(()=>clearTimeout(timer));
  prefetchRequest={marketId,abort,result};
 };
 let summaryPending:Promise<void>|null=null;
 const runRefresh=async(force=false)=>{
  const requestedKey=id?`${id.marketId}:summary`:'';
  if(controller&&activeKey===requestedKey&&!controller.signal.aborted)return;
  if(!id||!base){data=null;state=id?'error':'loading';if(id&&!base){chartData=null;chartState='error';renderChartChange();}render();return;}
  const identity=id,chosen='1H' as const,key=`${identity.marketId}:summary`,cached=cache.get(key);
  if(!force&&cached&&Date.now()<cached.refreshAt)return;
  const own=++generation;controller?.abort();controller=null;clearTimeout(expiry);
  // Summary data is market-scoped; chart selection never invalidates it.
  data=cached&&Date.now()<cached.until?cached.data:null;state='loading';if(!data)render();else text('[data-detail-source]',sourceLabel());
  const abort=new AbortController();controller=abort;activeKey=key;const timer=setTimeout(()=>abort.abort(),12000);
  try{
   const api=new TickerGardenV1Client(base,(input,init)=>fetch(input,{...init,signal:abort.signal}));
   const pending=prefetchRequest?.marketId===identity.marketId?prefetchRequest:null;
   prefetchRequest=null;
   const cancel=()=>pending?.abort.abort();abort.signal.addEventListener('abort',cancel,{once:true});
   let raw:TokenDetailResponse;
   try{if(pending){const result=await pending.result;if('error' in result)throw result.error;raw=result.value;}else raw=await api.getTokenDetail({marketId:identity.marketId,period:chosen});}
   finally{abort.signal.removeEventListener('abort',cancel);}

   const next=validateTokenDetail(raw,chain,identity,chosen);if(own!==generation||abort.signal.aborted)return;
   if(data?.confirmation==='confirmed'&&next.confirmation!=='confirmed'&&BigInt(next.sources.trades?.blockNumber??'0')<BigInt(data.sources.trades?.blockNumber??'0')){state='ready';return;}
   const changed=JSON.stringify(data)!==JSON.stringify(next);data=next;state='ready';const times=Object.values(next.sources).map(s=>s.asOf);
   const until=times.length?(Math.min(...times)+1200)*1000:Date.now()+30000;
   activityLoader?.seed();
   if(activity&&next.sources.trades&&BigInt(next.sources.trades.blockNumber)>=BigInt(activity.sources.trades!.blockNumber))activity=null;
   cache.set(key,{data:next,until,refreshAt:Math.min(Date.now()+(next.confirmation==='confirmed'?5000:15000),until)});
   if(next.chart&&next.sources.chart){chartCache.set(chartKeyFor(identity,chosen,next.sources.chart.asOf),{value:next.chart,until:Math.min(Date.now()+15000,(next.sources.chart.asOf+1200)*1000)});}
   if(changed)render();else text('[data-detail-source]',sourceLabel());
   void refreshChart();
   expiry=setTimeout(()=>{if(own===generation){data=null;state='pending';render();}},Math.max(0,(times.length?Math.min(...times)*1000+1200000:until)-Date.now()));
  }catch(error){if(own===generation){state=error instanceof TickerGardenApiError&&error.status===503&&error.body.error==='analytics_unavailable'?'pending':'error';render();}}
  finally{clearTimeout(timer);if(own===generation)controller=null;}
 };
 const refresh=(force=false):Promise<void>=>{if(summaryPending)return summaryPending;const pending=runRefresh(force).finally(()=>{if(summaryPending===pending)summaryPending=null;});summaryPending=pending;return pending;};
 for(const b of root.querySelectorAll<HTMLButtonElement>('[data-detail-period]'))b.onclick=()=>{if(period===b.dataset.detailPeriod&&chartState!=='error')return;period=b.dataset.detailPeriod as DetailPeriod;root.querySelectorAll('[data-detail-period]').forEach(v=>{v.classList.toggle('active',v===b);v.setAttribute('aria-pressed',String(v===b));});void refreshChart();};
 q('[data-detail-more-trades]').onclick=()=>{if(id)window.open(`${explorer}/token/${id.memeToken}?tab=token_transfers`,'_blank','noopener,noreferrer');};q('[data-detail-more-holders]').onclick=()=>{if(id)window.open(`${explorer}/token/${id.memeToken}?tab=holders`,'_blank','noopener,noreferrer');};
 // One market stream fans out scoped invalidations; no independent fast timers.
 const updateRegions=async(regions:readonly DetailRegion[])=>{
  if(!id||!base)return;
  const identity=id,chosen=period;
  if(summaryPending)await summaryPending;
  if(id!==identity)return;
  const selected=regions.filter(r=>!['market','staking'].includes(r));
  if(regions.includes('market')||regions.includes('staking'))root.dispatchEvent(new CustomEvent('market-regions',{detail:{marketId:identity.marketId,regions}}));
  if(!selected.length)return;
  partialAbort?.abort();const abort=new AbortController();partialAbort=abort;const timeout=setTimeout(()=>abort.abort(),12000);
  try{
   const response=await fetch(`${base.replace(/\/$/,'')}/v1/markets/${identity.marketId}/detail?period=${chosen}&section=${selected.join(',')}`,{signal:abort.signal});
   if(!response.ok)throw Error('Detail refresh unavailable');
   const next=validateTokenDetail(await response.json(),chain,identity,chosen);
   if(id!==identity||abort.signal.aborted)return;
   if(data?.confirmation==='confirmed'&&next.confirmation!=='confirmed'&&Math.max(...Object.values(next.sources).map(s=>Number(s.blockNumber)),0)<Math.max(...Object.values(data.sources).map(s=>Number(s.blockNumber)),0))return;
   // A notification supersedes an older initial fetch, but never clears other sections.
   generation++;controller?.abort();controller=null;prefetchRequest?.abort.abort();prefetchRequest=null;
   const merged={...(data??next),sources:{...data?.sources,...next.sources},reasons:{...data?.reasons,...next.reasons}};
   for(const key of selected as Array<'statistics'|'chart'|'trades'|'holders'|'fees'>){merged[key]=next[key] as never;}
   if(selected.includes('chart'))merged.period=chosen;
   merged.confirmation=next.confirmation;data=merged;activity=null;state='ready';
   cache.set(`${identity.marketId}:summary`,{data:merged,until:Date.now()+1200000,refreshAt:Date.now()+60000});
   if(selected.includes('chart')&&period===chosen){chartGeneration++;chartRequest?.abort();chartRequest=null;chartData=next.chart;chartState=next.chart?'ready':'pending';chartCache.clear();}
   render();
  }finally{clearTimeout(timeout);if(partialAbort===abort)partialAbort=null;}
 };
 const observer=new ResizeObserver(()=>draw());observer.observe(q('[data-detail-chart]'));
 render();return{refresh,prefetch,receipt(hash:string){activityLoader?.receipt(hash);},setMarket(value:DetailIdentity|null){if(id?.marketId!==value?.marketId){changes?.stop();changes=null;partialAbort?.abort();summaryPending=null;activityLoader?.stop();activityLoader=null;activity=null;generation++;controller?.abort();controller=null;clearTimeout(expiry);if(value&&prefetchRequest?.marketId!==value.marketId){prefetchRequest?.abort.abort();prefetchRequest=null;}cache.clear();chartCache.clear();chartGeneration++;chartRequest?.abort();chartRequest=null;chartData=null;chartState='loading';data=null;recentTrades=[];chartTrades=[];feeTotals=null;feeTotalsAt=0;}overview={};tradePrice=null;id=value;if(id&&base&&!activityLoader)activityLoader=createDetailActivity(base,chain,id,value=>{if(data?.confirmation==='confirmed'&&value.confirmation!=='confirmed'&&BigInt(value.sources.trades?.blockNumber??'0')<BigInt(data.sources.trades?.blockNumber??'0'))return;activity=value;render();});if(id&&base&&!changes)changes=watchMarketChanges(base,id.marketId,updateRegions);fees=null;tradeLimit=20;holderLimit=20;void refresh();},setChartTrades(_value:readonly TokenDetailTrade[]){/* Database chart only. */},addRecentTrades(_value:readonly TokenDetailTrade[]){/* Database activity only. */},setTradePrice(_value:string|null){/* Quotes belong only to the transaction form. */},setOverview(value:MarketOverview){const next={...overview,...value};if(JSON.stringify(next)===JSON.stringify(overview))return;const chartTimeChanged=next.asOf!==overview.asOf;overview=next;render();if(chartTimeChanged&&!chartData&&!chartRequest)void refreshChart();},setUnavailable(publicationPending=false){changes?.stop();changes=null;partialAbort?.abort();activityLoader?.stop();activityLoader=null;activity=null;prefetchRequest?.abort.abort();prefetchRequest=null;generation++;controller?.abort();controller=null;chartGeneration++;chartRequest?.abort();chartRequest=null;chartData=null;chartState=publicationPending?'pending':'error';data=null;state=publicationPending?'pending':'error';clearTimeout(expiry);render();},setFeeTotals(value:readonly TokenDetailFee[]){feeTotals=value;feeTotalsAt=Date.now();renderFees();},setFeeConfig(value:FeeConfig|null){if(JSON.stringify(fees)===JSON.stringify(value))return;fees=value;renderFees();},stop(){changes?.stop();partialAbort?.abort();activityLoader?.stop();prefetchRequest?.abort.abort();prefetchRequest=null;generation++;controller?.abort();chartGeneration++;chartRequest?.abort();clearTimeout(expiry);observer.disconnect();id=null;data=null;}};
}
