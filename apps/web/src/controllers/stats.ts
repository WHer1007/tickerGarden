import {mountStatsStockList} from '../ui/stats-stock-list.ts';
import {robinhoodChain} from '../v1/chain.ts';
import {quoteIconUrl} from '../create/quote-icons.ts';
import {STAKING_ASSETS} from '../create/staking-assets.ts';
import {createStatsDisplayUpdater} from '../v1/statsUpdates.ts';
import type {StatsSection,StatsStock} from '../v1/statsDisplay.ts';
import type {StatsContext} from '../app.ts';

export function createStatsController(ctx:StatsContext){
 let statsStockList:ReturnType<typeof mountStatsStockList>|undefined;
 let stockContainer:HTMLElement|undefined;
 let started=false;
 const sectionsForPage=():StatsSection[]=>ctx.currentPage()==='statsStocks'?['stocks']:ctx.currentPage()==='stats'?['overview','allocations','stocks']:[];
 const endpoint=(section:StatsSection)=>{const api=ctx.runtimeConfig.readApi;return `${api.available?api.value.replace(/\/$/,''):''}/v1/stats/display?section=${section}`;};
 function statsAsset(address:string):{label:string;icon?:string}{return {label:address,icon:quoteIconUrl(address)};}
 function usdText(value:string|null|undefined):string{return value===undefined||value===null?'-':ctx.formatMarketUSD(value,true);}
 function display(section?:StatsSection){
  if(!['stats','statsStocks'].includes(ctx.currentPage()))return;
  const sections=updater.snapshot.sections;
  if((!section||section==='overview')&&ctx.currentPage()==='stats'){
   const overview=sections.overview;
   ctx.text('[data-stat-volume]',usdText(overview?.volumeUsd));
   ctx.text('[data-stat-fee-revenue]',usdText(overview?.feeRevenueUsd));
   ctx.text('[data-stat-launches]',overview?.launches24h===null||overview?.launches24h===undefined?'-':overview.launches24h.toLocaleString());
   ctx.text('[data-stat-bloomed]',overview?.bloomedMarkets===undefined?'-':overview.bloomedMarkets.toLocaleString());
   ctx.text('[data-stat-stock-value]',usdText(overview?.stakingValueUsd));
   ctx.text('[data-stat-staking-wallets]',overview?.stakingWallets===null||overview?.stakingWallets===undefined?'-':overview.stakingWallets.toLocaleString());
  }
  if((!section||section==='allocations')&&ctx.currentPage()==='stats'){
   const allocations=sections.allocations;
   for(const key of ['creator','staker','holder','platform'] as const)ctx.text(`[data-stat-fee-${key}]`,usdText(allocations?.[key]));
  }
  if((!section||section==='stocks')&&sections.stocks&&stockContainer){
   if(!statsStockList)statsStockList=mountStatsStockList(stockContainer,{full:ctx.currentPage()==='statsStocks'});
   statsStockList.update(sections.stocks.map((row:StatsStock)=>{
    const asset=STAKING_ASSETS.find(item=>item.chainId===robinhoodChain.id&&item.tokenAddress.toLowerCase()===row.token.toLowerCase()&&item.assetUid.toLowerCase()===row.id.toLowerCase());
    return {id:row.id,label:asset?.symbol??row.label,name:row.name??asset?.name,icon:asset?.logoUrl??(asset?.symbol?quoteIconUrl(asset.symbol):statsAsset(row.label).icon),decimals:row.decimals,amount:BigInt(row.amountRaw),value:row.valueUsd};
   }));
  }
  ctx.query<HTMLElement>('[data-stats-summary]')?.setAttribute('aria-busy','false');
 }
 const updater=createStatsDisplayUpdater({
  chainId:robinhoodChain.id,
  fetcher:async(section,signal)=>{
   if(!ctx.runtimeConfig.readApi.available)throw Error('Stats read API unavailable');
   const response=await fetch(endpoint(section),{signal});
   if(!response.ok)throw Error(`Stats request failed (${response.status})`);
   return response.json();
  },
  getSections:sectionsForPage,
  onSection:section=>display(section),
  eventSource:()=>{
   const api=ctx.runtimeConfig.readApi;
   if(!api.available)throw Error('Stats read API unavailable');
   return new EventSource(`${api.value.replace(/\/$/,'')}/v1/stats/events`);
  },
 });
 function clearStatsSnapshotView(_message:string):void{/* Global publication health does not invalidate stored Stats. */}
 function setupStats():void{
  const container=ctx.query<HTMLElement>('[data-stats-staking-values]');
  if(container&&container!==stockContainer){statsStockList?.destroy();stockContainer=container;statsStockList=undefined;}
  ctx.text('[data-stats-network]',robinhoodChain.id===46630?'Testnet data':'Robinhood Chain');
  display();
  document.removeEventListener('visibilitychange',onVisibility);
  document.addEventListener('visibilitychange',onVisibility);
  if(!document.hidden&&!started){updater.start();started=true;}
 }
 function applyStatsSnapshot():void{display();}
 async function renderStats(force=false):Promise<void>{
  if(document.hidden||!ctx.runtimeConfig.readApi.available)return;
  if(!started){updater.start();started=true;}
  await updater.refresh(sectionsForPage(),force);
 }
 function onVisibility(){
  if(!['stats','statsStocks'].includes(ctx.currentPage())){updater.stop();started=false;return;}
  if(document.hidden){updater.stop();started=false;}
  else{updater.start();started=true;void updater.refresh(sectionsForPage(),true);}
 }
 function dispose(){updater.stop();started=false;document.removeEventListener('visibilitychange',onVisibility);statsStockList?.destroy();statsStockList=undefined;stockContainer=undefined;}
 return {statsAsset,clearStatsSnapshotView,setupStats,applyStatsSnapshot,renderStats,dispose};
}
