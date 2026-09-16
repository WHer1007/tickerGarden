import {mountStatsStockList} from '../ui/stats-stock-list.ts';
import {robinhoodChain} from '../v1/chain.ts';
import {quoteIconUrl} from '../create/quote-icons.ts';
import {stakingAssetForConfig} from '../create/staking-assets.ts';
import {shortHex} from '../runtime/model.ts';
import {decimalProduct,parseProtocolStatistics,type ProtocolStatistics} from '../v1/protocolStatistics.ts';
import {statisticsUSD} from '../v1/statisticsValue.ts';
import {sumStatisticsUSD} from '../v1/statsSummary.ts';
import {type Hex} from 'viem';
import type {StatsContext} from '../app.ts';
export function createStatsController(ctx:StatsContext){
function clearStatsSnapshotView(_message: string): void {
  for(const selector of ['[data-stat-market-cap]','[data-stat-volume]','[data-stat-launches]','[data-stat-bloomed]','[data-stat-total-markets]'])ctx.text(selector,'-');
  statsStockList?.setUnavailable();
  for(const selector of ['[data-stats-phase-list]','[data-stats-quote-list]']){
    const container=ctx.query<HTMLElement>(selector);if(container){const empty=document.createElement('p');empty.className='stats-empty';empty.textContent='Data is not available yet';container.replaceChildren(empty);}
  }
  for(const selector of ['[data-stats-growing-bar]','[data-stats-bloomed-bar]']){const bar=ctx.query<HTMLElement>(selector);if(bar)bar.style.width='0%';}
  ctx.query<HTMLElement>('[data-stats-summary]')?.setAttribute('aria-busy','false');
}
function setupStats(): void {
 const list=ctx.query<HTMLElement>('[data-stats-staking-values]');if(list)statsStockList=mountStatsStockList(list,{full:ctx.currentPage()==='statsStocks'});
 ctx.text('[data-stats-network]',robinhoodChain.id===46630?'Testnet data':'Robinhood Chain');
}
function statsAsset(address:string):{label:string;icon?:string}{
 if(address==='0x'+'0'.repeat(40))return{label:'ETH',icon:quoteIconUrl('ETH')};
 const asset=ctx.foundation?.assets.find(c=>ctx.stockToken(c)?.toLowerCase()===address.toLowerCase());
 const listed=asset?stakingAssetForConfig(robinhoodChain.id,asset):undefined;
 return{label:listed?.symbol??(typeof asset?.values.tokenSymbol==='string'?asset.values.tokenSymbol:undefined)??ctx.marketStockSymbols.get(address)??shortHex(address,6,4),icon:asset?ctx.stockLogo(asset):undefined};
}
function renderStatsDistribution(selector:string,groups:Map<string,{label:string;icon?:string;count:number}>,total:number){
 const list=ctx.query<HTMLElement>(selector);if(!list)return;
 if(!groups.size){const empty=document.createElement('p');empty.className='stats-empty';empty.textContent='No markets yet';list.replaceChildren(empty);return;}
 const fragment=document.createDocumentFragment();
 for(const group of [...groups.values()].sort((a,b)=>b.count-a.count||a.label.localeCompare(b.label))){
  const wrapper=document.createElement('div'),row=document.createElement('div');row.className='stats-distribution-row';
  const label=document.createElement('span');label.className='stats-asset-label';
  if(group.icon){const image=document.createElement('img');image.src=group.icon;image.alt='';image.onerror=()=>image.remove();label.append(image);}
  const name=document.createElement('span');name.textContent=group.label;label.append(name);
  const value=document.createElement('span');value.className='stats-distribution-value';const count=document.createElement('strong');count.textContent=group.count.toLocaleString();const percent=document.createElement('small');percent.textContent=`${total?Math.round(group.count/total*100):0}%`;value.append(count,percent);row.append(label,value);
  const track=document.createElement('div');track.className='stats-distribution-track';track.setAttribute('aria-hidden','true');const fill=document.createElement('span');fill.style.width=`${total?group.count/total*100:0}%`;track.append(fill);wrapper.append(row,track);fragment.append(wrapper);
 }
 list.replaceChildren(fragment);
}
let statsStockList:ReturnType<typeof mountStatsStockList>|undefined;
let statsSnapshot:ProtocolStatistics|null=null,statsReadAt=0,statsRetryAt=0;
let statsRequest:Promise<any>|null=null,statsAbort:AbortController|null=null;
const statsFresh=(at:unknown)=>typeof at==='number'&&Number.isSafeInteger(at)&&at>0&&at<=Date.now()/1000+5&&Date.now()/1000-at<25*60;
function statsPrices(){
 const snapshot=ctx.assetPrices.snapshot();
 const rows=Object.values(snapshot.prices).filter(p=>snapshot.chainId===robinhoodChain.id&&p.status==='available'&&p.midpointUsd!==null&&p.expiresAt!==null);
 return {prices:Object.fromEntries(rows.map(p=>[p.token,p.midpointUsd])),expiresAt:Object.fromEntries(rows.map(p=>[p.token,Math.floor(p.expiresAt!/1000)]))};
}
function applyStatsSnapshot():void{
 if(!['stats','statsStocks'].includes(ctx.currentPage()))return;
 const summary=statsSnapshot,prices=statsPrices(),fresh=summary&&statsFresh(summary.observedAt);
 const value=(amount:unknown,asset:string)=>{
  const reference=summary?.feePriceQuotes[asset];
  const quotePrice=reference?prices.prices[reference.quoteAsset]:undefined;
  const price=prices.prices[asset]??(reference&&quotePrice?decimalProduct(reference.priceQuote,quotePrice):undefined);
  const expires=prices.prices[asset]?prices.expiresAt[asset]:reference?prices.expiresAt[reference.quoteAsset]:undefined;
  return statisticsUSD(amount,summary?.feeDecimals?.[asset],price,expires,Date.now());
 };
 const sum=(amounts:Record<string,string>|undefined)=>amounts?sumStatisticsUSD(Object.entries(amounts).map(([asset,amount])=>value(amount,asset))):null;
 const volume=fresh&&summary.volumeCoverage===true?sum(summary.volumeAmounts):null;
 const revenue=fresh&&summary.feeCoverage===true&&summary.feeBasis==='TRADE_TIME'?sum(summary.feeTotals):null;
 ctx.text('[data-stat-volume]',volume===null?'-':ctx.formatMarketUSD(volume,true));
 ctx.text('[data-stat-fee-revenue]',revenue===null?'-':ctx.formatMarketUSD(revenue,true));
 for(const [key,field]of [['launches','launches24h'],['bloomed','bloomedMarketCount']] as const)ctx.text(`[data-stat-${key}]`,fresh&&summary[field]!==null&&Number.isSafeInteger(summary[field])&&summary[field]!>=0?summary[field]!.toLocaleString():'-');
 const stakingFresh=summary?.stakingCoverage===true&&statsFresh(summary.stakingObservedAt);
 ctx.text('[data-stat-staking-wallets]',stakingFresh&&Number.isSafeInteger(summary.stakingWallets)?summary.stakingWallets!.toLocaleString():'-');
 for(const bucket of ['creator','staker','holder','platform']){
  const amounts=fresh&&summary.allocationCoverage===true?Object.entries(summary.feeAssets as Record<string,Record<string,string>>).map(([asset,buckets])=>value(buckets[bucket],asset)):null;
  const total=amounts?sumStatisticsUSD(amounts):null;
  ctx.text(`[data-stat-fee-${bucket}]`,total===null?'-':ctx.formatMarketUSD(total,true));
 }
 const rows=[...new Map((ctx.foundation?.assets??[]).map(asset=>[asset.id,asset])).values()].map(asset=>{
  const token=ctx.stockToken(asset),info=token?statsAsset(token):{label:shortHex(asset.id)},decimals=Number(asset.values.tokenDecimals);
  const raw=stakingFresh&&summary.stockAmounts?summary.stockAmounts[asset.id]??'0':undefined;
  const amount=typeof raw==='string'&&/^(0|[1-9][0-9]*)$/.test(raw)?BigInt(raw):null;
  return {id:asset.id,...info,name:stakingAssetForConfig(robinhoodChain.id,asset)?.name,decimals,amount,value:amount===null?null:statisticsUSD(raw,decimals,prices.prices[token?.toLowerCase()??''],prices.expiresAt[token?.toLowerCase()??''],Date.now())};
 });
 for(const [id,raw]of Object.entries(summary?.stockAmounts??{}))if(BigInt(raw)>0n&&!rows.some(row=>row.id===id))rows.push({id:id as Hex,label:shortHex(id),name:undefined,decimals:0,amount:BigInt(raw),value:null});
 const stockTotal=stakingFresh?sumStatisticsUSD(rows.map(r=>r.value)):null;
 ctx.text('[data-stat-stock-value]',stockTotal===null?'-':ctx.formatMarketUSD(stockTotal,true));
 if(stakingFresh)statsStockList?.update(rows);else statsStockList?.setUnavailable();
 const time=(at:number)=>new Date(at*1000).toLocaleString('en-US',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'});
 ctx.text('[data-stats-updated]',summary?`Activity as of ${time(summary.observedAt)} · refreshed every 20 minutes`:'Updates every 20 minutes');
 ctx.query<HTMLElement>('[data-stats-summary]')?.setAttribute('aria-busy','false');
}
async function renderProtocolStatistics(force=false):Promise<any>{
 if(!ctx.runtimeConfig.readApi.available)throw Error('Stats syncing');
 if(statsRequest)return statsRequest;
 if(!force&&statsSnapshot&&statsFresh(statsSnapshot.observedAt)&&(!statsSnapshot.stakingCoverage||statsFresh(statsSnapshot.stakingObservedAt))&&Date.now()<Math.min(statsReadAt+20*60_000,statsSnapshot.nextRefreshAt*1000))return statsSnapshot;
 if(!force&&Date.now()<statsRetryAt)return statsSnapshot;
 const request=new AbortController();statsAbort=request;
 const timer=setTimeout(()=>request.abort(),15000);
 const pending=fetch(`${ctx.runtimeConfig.readApi.value}/v1/protocol-statistics`,{signal:request.signal}).then(async response=>{
  if(!response.ok)throw Error('Stats syncing');const summary=parseProtocolStatistics(await response.json(),robinhoodChain.id);
  if(statsAbort!==request)return null;
  statsSnapshot=summary;statsReadAt=Date.now();statsRetryAt=0;return summary;
 }).catch(error=>{if(statsAbort===request){statsSnapshot=null;statsRetryAt=Date.now()+30000;}throw error;}).finally(()=>{clearTimeout(timer);if(statsAbort===request){statsRequest=null;statsAbort=null;}});
 statsRequest=pending;return pending;
}
async function renderStats(force=false):Promise<void>{
 const render=ctx.statsRender.begin();
 try{await renderProtocolStatistics(force);}catch{ /* Render the cleared snapshot consistently, including Stock rows. */ }
 if(!render.isCurrent())return;
 applyStatsSnapshot();
}



function dispose(){statsStockList?.destroy();statsStockList=undefined;statsAbort?.abort();statsAbort=null;statsRequest=null;}
return {statsAsset,clearStatsSnapshotView,setupStats,applyStatsSnapshot,renderStats,dispose};
}
