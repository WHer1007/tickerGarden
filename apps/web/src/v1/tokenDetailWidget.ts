import {feeQuoteValue} from './feeQuoteValue.ts';
import {compactPrice} from "../ui/compact-price.ts";
import {chartFromTrades} from './tradeChart.ts';
import {formatTradePrice} from './tradePricing.ts';
import {mergeRecentTrades} from './recentTrades.ts';
import type {TokenDetailTrade,TokenDetailFee} from './generated/read-api.ts';
import {marketCapUsd,type MarketOverview} from './marketOverview.ts';
import {TickerGardenV1Client,TickerGardenApiError,type TokenDetailResponse} from './generated/read-api.ts';
import {validateTokenDetail,displayDecimal,scaledDecimal,feeRows,type DetailIdentity,type DetailPeriod,type FeeConfig} from './tokenDetail.ts';
import {candleVolume} from './candleTable.ts';
export function mountTokenDetail(root:HTMLElement,base:string|null,chain:number,explorer:string){
 const q=<T extends HTMLElement=HTMLElement>(s:string)=>root.querySelector<T>(s)!;
 const text=(s:string,v:string)=>root.querySelectorAll<HTMLElement>(s).forEach(e=>e.textContent=v);
 let id:DetailIdentity|null=null,period:DetailPeriod='1H',data:TokenDetailResponse|null=null,fees:FeeConfig|null=null,controller:AbortController|null=null,generation=0,expiry:ReturnType<typeof setTimeout>|undefined,tradeLimit=20,holderLimit=20;
 let state:'loading'|'ready'|'pending'|'error'='loading';
 let activeKey='';
 let overview:MarketOverview={};
 let tradePrice:string|null=null;
 let feeTotals:readonly TokenDetailFee[]|null=null,feeTotalsAt=0;
 let recentTrades:TokenDetailTrade[]=[];
 let chartTrades:TokenDetailTrade[]=[];
 const currentChart=()=>{const local=chartFromTrades([...chartTrades,...recentTrades],period);return local.points.some(p=>p.price!==null)?local:data?.chart??local;};
 const cache=new Map<string,{data:TokenDetailResponse;until:number;refreshAt:number}>();
 const stateText=()=>state==='loading'?'Loading Data…':state==='pending'?'Statistics Not Ready':state==='error'?'Could Not Load Data. Try Refresh.':'Some Statistics Are Not Ready';
 const amount=(raw:string,d:number)=>displayDecimal(candleVolume(raw,d),6);
 const empty=(tbody:HTMLTableSectionElement,message:string,cols:number)=>{tbody.replaceChildren();const td=tbody.insertRow().insertCell();td.colSpan=cols;td.className='detail-empty-cell';const box=document.createElement('div');box.className='detail-activity-empty';box.setAttribute('role','status');const icon=document.createElement('i');icon.className=cols===6?'ph ph-arrows-left-right':'ph ph-users';icon.setAttribute('aria-hidden','true');const label=document.createElement('span');label.textContent=message;box.append(icon,label);td.append(box);};
 const sourceLabel=()=>{if(chartTrades.length||recentTrades.length)return '';if(!data)return stateText();const entries=Object.entries(data.sources).filter(([k])=>['statistics','chart','trades','holders','fees'].includes(k));if(!entries.length)return 'Statistics Not Ready';const providers=[...new Set(entries.map(([,s])=>s.provider==='dune'?'Dune':'Indexer'))];const oldest=Math.min(...entries.map(([,s])=>s.asOf));q('[data-detail-source]').title=entries.map(([k,s])=>`${k}: ${s.provider} · ${new Date(s.asOf*1000).toLocaleString()} · block ${s.blockNumber}`).join(' | ');return `${state==='loading'?'Refreshing · ':state==='error'||state==='pending'?'Refresh Failed · Showing Cached Data · ':''}${providers.join(' + ')} · Updated ${new Date(oldest*1000).toLocaleTimeString()} · Historical data`;};
 const draw=()=>{
  const canvas=q<HTMLCanvasElement>('[data-detail-chart] canvas'),ctx=canvas.getContext('2d');if(!ctx)return;
  const box=canvas.parentElement!.getBoundingClientRect(),w=Math.max(250,box.width),h=Math.max(180,box.height),dpr=window.devicePixelRatio||1;canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr);canvas.style.width=`${w}px`;canvas.style.height=`${h}px`;ctx.scale(dpr,dpr);ctx.clearRect(0,0,w,h);
  const chart=currentChart(),active=chart?.points.filter(p=>p.price!==null)??[];ctx.font='12px "Inter Variable"' ;ctx.fillStyle='#718092';
  if(!chart||!active.length){ctx.textAlign='center';ctx.fillText(chart?'No Trades In This Period':stateText(),w/2,h/2);canvas.setAttribute('aria-label',chart?'No Trades In This Period':stateText());return;}
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
 const renderFees=()=>{
  const feeData=data?.fees??(Date.now()-feeTotalsAt<1200000?feeTotals:null);
  const metrics=q('[data-detail-fee-metrics]'),bar=q('[data-detail-fee-bar]'),rows=q('[data-detail-fee-rows]');metrics.replaceChildren();bar.replaceChildren();rows.replaceChildren();
  if(!fees){metrics.textContent='-';rows.textContent=state==='loading'?'Loading Fee Settings…':'Fee Settings Not Ready';text('[data-detail-fee-status]','-');return;}
  const values=feeRows(fees);metrics.style.gridTemplateColumns=`repeat(${values.filter(row=>row.key!=='holders').length},minmax(0,1fr))`;bar.style.gridTemplateColumns=values.map(r=>`${r.percent??1}fr`).join(' ');
  for(const v of values){const cell=document.createElement('div'),strong=document.createElement('strong'),pct=document.createElement('span'),label=document.createElement('small');strong.textContent=v.percent===null?'-':String(v.percent);pct.textContent='%';strong.append(pct);label.textContent=v.label;cell.append(strong,label);cell.dataset.feeRecipient=v.key;cell.classList.toggle('is-zero',v.percent===0);if(v.key==='holders'){const creator=metrics.querySelector('[data-fee-recipient="creator"]');if(creator){const share=document.createElement('span');share.className='fee-holder-share';share.textContent=`Holders ${v.percent===null?'-':`${v.percent}%`}`;creator.append(share);}}else{metrics.append(cell);}const part=document.createElement('span');part.title=`${v.label} ${v.percent??'-'}%`;part.hidden=v.percent===0;bar.append(part);
   const row=document.createElement('div'),percent=document.createElement('strong'),name=document.createElement('b'),note=document.createElement('span'),total=document.createElement('p');percent.textContent=v.percent===null?'-':`${v.percent}%`;name.textContent=v.label;note.textContent=v.note;const amounts=feeData?.filter(f=>f.recipient===v.key);const quoteValue=feeData&&id?feeQuoteValue(amounts!,id.quoteAsset,id.memeToken,id.quoteDecimals,tradePrice??overview.price??data?.statistics?.price):null;total.textContent=quoteValue===null||quoteValue==='0'?'-':`${Number(quoteValue)>=1000?new Intl.NumberFormat('en-US',{notation:'compact',maximumFractionDigits:2}).format(Number(quoteValue)):displayDecimal(quoteValue,6)} ${id!.quoteSymbol}`;if(quoteValue!==null&&quoteValue!=='0')total.title=`${quoteValue} ${id!.quoteSymbol} · Estimated At Current Price`;row.append(percent,name,note,total);row.classList.toggle('is-zero',v.percent===0);rows.append(row);
  }
  rows.querySelectorAll('.is-zero').forEach(row=>rows.append(row));
  text('[data-detail-fee-status]',`${fees.phase===0?'Curve':fees.active===null?'Stake status unavailable':fees.active?'Staking active':'No active stake'} · Holder sharing ${fees.holders?'on':'off'}`);
  text('[data-detail-fee-note]','');
  text('[data-detail-fee-rules]',[fees.taxBps>0?`Additional Creator Tax: ${fees.taxBps/100}%`:'',data?.sources.fees?`Updated ${new Date(data.sources.fees.asOf*1000).toLocaleString()}`:feeData?`Allocated Fees · Estimated ${id?.quoteSymbol??'Quote'} Value`:'Earnings Data Pending'].filter(Boolean).join(' · '));
 };
 const render=()=>{
  const stats=data?.statistics,h=overview.holders?{...overview.holders,totalSupplyRaw:overview.supply??'0'}:data?.holders;
  const exactPrice=tradePrice??overview.price??stats?.price; text('[data-detail-price]',compactPrice(exactPrice));q('[data-detail-price]').title=exactPrice??'';text('[data-detail-price-unit]',id?`Price (${id.quoteSymbol})`:'Price');
  const volume=overview.volume24h??stats?.volume24h;
  text('[data-detail-volume]',volume!==null&&volume!==undefined&&id?`${displayDecimal(volume,6)} ${id.quoteSymbol}`:'-');
  text('[data-detail-holders]',h?h.count.toLocaleString():'-');text('[data-detail-circulating]',overview.supply!==undefined?amount(overview.supply,18):'-');
  if(overview.maximum!==undefined)text('[data-detail-supply]',amount(overview.maximum,18));
  const cap=marketCapUsd(overview.supply,overview.price,overview.usd);text('[data-detail-cap]',cap!==null?`$${displayDecimal(cap,2)}`:'-');
  const active=currentChart().points.filter(p=>p.price!==null)??[];let change='-';if(active.length>1){const first=scaledDecimal(active[0]!.price!),last=scaledDecimal(active.at(-1)!.price!);const bps=(last-first)*10000n/first;change=`${bps>=0n?'+':'−'}${(bps<0n?-bps:bps)/100n}.${((bps<0n?-bps:bps)%100n).toString().padStart(2,'0')}% (${period})`;q('[data-detail-change]').classList.toggle('ref-negative',bps<0n);}text('[data-detail-change]',change);
  const visibleTrades=mergeRecentTrades(data?.trades??[],recentTrades);
  const trades=q<HTMLTableSectionElement>('[data-detail-trades-body]');empty(trades,data?.trades?'No Trades Yet':state==='loading'?'Loading Trades…':state==='error'?'Could Not Load Trades':'No Trade Data Yet',6);
  if(visibleTrades.length){trades.replaceChildren();for(const t of visibleTrades.slice(0,tradeLimit)){const row=trades.insertRow();row.title=t.classification==='unclassified'?'Contract caller; wallet identity unverified':'Internal reward conversion';const values=[new Date(t.timestamp*1000).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}),t.side==='buy'?'Buy':'Sell',formatTradePrice(t.price),amount(t.memeRaw,18),amount(t.quoteRaw,id!.quoteDecimals),t.actor?`${t.actor.slice(0,6)}…${t.actor.slice(-4)}`:'-'];values.forEach((v,i)=>{const c=row.insertCell();c.textContent=v;if(i===1)c.className=t.side;if(i===0){const link=document.createElement('a');link.href=`${explorer}/tx/${t.txHash}`;link.target='_blank';link.rel='noopener noreferrer';link.textContent=v;c.replaceChildren(link);}});}}
  const holders=q<HTMLTableSectionElement>('[data-detail-holders-body]');empty(holders,h?'No Holders To Show':state==='loading'?'Loading Holders…':state==='error'?'Could Not Load Holders':'No Holder Data Yet',3);if(h?.items.length){holders.replaceChildren();for(const v of h.items.slice(0,holderLimit)){const row=holders.insertRow(),bp=BigInt(h.totalSupplyRaw)?BigInt(v.balanceRaw)*10000n/BigInt(h.totalSupplyRaw):0n;for(const s of [`${v.account.slice(0,6)}…${v.account.slice(-4)}`,amount(v.balanceRaw,18),`${bp/100n}.${(bp%100n).toString().padStart(2,'0')}%`])row.insertCell().textContent=s;row.title=v.account;}}
  q('[data-detail-more-trades]').hidden=!id;q('[data-detail-more-holders]').hidden=!id;text('[data-detail-source]',sourceLabel());renderFees();
  for(const el of root.querySelectorAll<HTMLElement>('[data-detail-price],[data-detail-volume],[data-detail-holders],[data-detail-circulating],[data-detail-cap],[data-detail-change]')){el.classList.toggle('detail-loading',state==='loading'&&el.textContent==='-');el.title=el.textContent==='-'?stateText():'';}
  q('[data-detail-source]').setAttribute('role','status');
  draw();
 };
 const refresh=async(force=false)=>{
  const requestedKey=id?`${id.marketId}:${period}`:'';
  if(controller&&activeKey===requestedKey&&!controller.signal.aborted)return;
  const own=++generation;controller?.abort();controller=null;clearTimeout(expiry);
  if(!id||!base){data=null;state=id?'error':'loading';render();return;}
  const identity=id,chosen=period,key=`${identity.marketId}:${chosen}`,cached=cache.get(key);
  if(!force&&cached&&Date.now()<cached.refreshAt){data=cached.data;state='ready';render();return;}
  // Keep usable results visible during a refresh, but never carry another period's data.
  data=cached&&Date.now()<cached.until?cached.data:null;state='loading';render();
  const abort=new AbortController();controller=abort;activeKey=key;const timer=setTimeout(()=>abort.abort(),12000);
  try{
   const api=new TickerGardenV1Client(base,(input,init)=>fetch(input,{...init,signal:abort.signal}));
   const raw=await api.getTokenDetail({marketId:identity.marketId,period:chosen});
   const next=validateTokenDetail(raw,chain,identity,chosen);if(own!==generation||abort.signal.aborted)return;
   data=next;state='ready';const times=Object.values(next.sources).map(s=>s.asOf);
   const until=times.length?(Math.min(...times)+1200)*1000:Date.now()+30000;
   cache.set(key,{data:next,until,refreshAt:Math.min(Date.now()+600000,until)});render();
   expiry=setTimeout(()=>{if(own===generation){data=null;state='pending';render();}},Math.max(0,(times.length?Math.min(...times)*1000+1200000:until)-Date.now()));
  }catch(error){if(own===generation){state=error instanceof TickerGardenApiError&&error.status===503&&error.body.error==='analytics_unavailable'?'pending':'error';render();}}
  finally{clearTimeout(timer);if(own===generation)controller=null;}
 };
 for(const b of root.querySelectorAll<HTMLButtonElement>('[data-detail-period]'))b.onclick=()=>{period=b.dataset.detailPeriod as DetailPeriod;root.querySelectorAll('[data-detail-period]').forEach(v=>{v.classList.toggle('active',v===b);v.setAttribute('aria-pressed',String(v===b));});void refresh();};
 q('[data-detail-more-trades]').onclick=()=>{if(id)window.open(`${explorer}/token/${id.memeToken}?tab=token_transfers`,'_blank','noopener,noreferrer');};q('[data-detail-more-holders]').onclick=()=>{if(id)window.open(`${explorer}/token/${id.memeToken}?tab=holders`,'_blank','noopener,noreferrer');};
 // Statistical analytics are intentionally refreshed every 10 minutes; this is
 // independent from live transaction, position, reward, and pricing refreshes.
 const observer=new ResizeObserver(draw);observer.observe(q('[data-detail-chart]'));const timer=setInterval(()=>{if(id&&document.visibilityState==='visible'&&navigator.onLine)void refresh();},600000);
 const visibility=()=>{if(document.visibilityState==='visible'&&navigator.onLine)void refresh();else{generation++;controller?.abort();controller=null;}};
 document.addEventListener('visibilitychange',visibility);window.addEventListener('online',visibility);window.addEventListener('offline',visibility);
 render();return{setMarket(value:DetailIdentity|null){if(id?.marketId!==value?.marketId){cache.clear();data=null;recentTrades=[];chartTrades=[];feeTotals=null;feeTotalsAt=0;}overview={};tradePrice=null;id=value;fees=null;tradeLimit=20;holderLimit=20;void refresh();},setChartTrades(value:readonly TokenDetailTrade[]){chartTrades=[...value];render();},addRecentTrades(value:readonly TokenDetailTrade[]){recentTrades=mergeRecentTrades(recentTrades,value);render();},setTradePrice(value:string|null){tradePrice=value;const exact=tradePrice??overview.price??data?.statistics?.price;text('[data-detail-price]',compactPrice(exact));q('[data-detail-price]').title=exact??'';renderFees();},setOverview(value:MarketOverview){overview={...overview,...value};render();},setUnavailable(){generation++;controller?.abort();controller=null;data=null;state='error';render();},setFeeTotals(value:readonly TokenDetailFee[]){feeTotals=value;feeTotalsAt=Date.now();renderFees();},setFeeConfig(value:FeeConfig|null){fees=value;renderFees();},stop(){generation++;controller?.abort();clearInterval(timer);clearTimeout(expiry);document.removeEventListener('visibilitychange',visibility);window.removeEventListener('online',visibility);window.removeEventListener('offline',visibility);observer.disconnect();id=null;data=null;}};
}
