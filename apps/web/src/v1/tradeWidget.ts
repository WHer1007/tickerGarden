import {TickerGardenV1Client,TickerGardenApiError,type MarketTradesResponse} from './generated/read-api.ts';
import {validateTradePage} from './trades.ts';
import {candlePriceLabel,type CandleIdentity} from './candles.ts';
import {candleVolume} from './candleTable.ts';
export function mountTrades(element:HTMLElement,baseUrl:string|null,chain:number){
 let id:CandleIdentity|null=null,page:MarketTradesResponse|null=null,controller:AbortController|null=null,generation=0,from=0,to=0;
 const status=document.createElement('p');status.setAttribute('role','status');const list=document.createElement('div');list.style.overflow='auto';list.style.maxHeight='480px';list.tabIndex=0;list.setAttribute('role','region');list.setAttribute('aria-label','Recent executions');element.style.minWidth='0';
 const refresh=document.createElement('button');refresh.type='button';refresh.textContent='Refresh trades';const more=document.createElement('button');more.type='button';more.textContent='Load more';more.hidden=true;element.append(status,list,refresh,more);
 const clear=()=>{page=null;list.replaceChildren();more.hidden=true;};
 const render=()=>{
  list.replaceChildren();if(!page)return;
  const table=document.createElement('table');const head=table.createTHead().insertRow();for(const name of ['Time (UTC)','Venue / side','Category','Meme amount','Quote amount','Price (Quote/Meme)','Caller identity']){const th=document.createElement('th');th.scope='col';th.textContent=name;head.append(th);}
  const body=table.createTBody();for(const t of page.items){const row=body.insertRow();for(const value of [new Date(Number(t.timestamp)*1000).toISOString().replace('T',' ').slice(0,19),`${t.venue} / ${t.side}`,t.classification==='unclassified'?'Unclassified':t.classification==='internal_reward_conversion'?'Internal rewards':'Internal Holder rewards',candleVolume(t.memeRaw,18),candleVolume(t.quoteRaw,t.quoteDecimals),candlePriceLabel(t.price),t.actor?`${t.actor} (contract caller; wallet unverified)`:'Unavailable'])row.insertCell().textContent=value;}
  for(const cell of table.querySelectorAll('th,td')){(cell as HTMLElement).style.padding='8px';(cell as HTMLElement).style.whiteSpace='nowrap';}
  list.append(table);more.hidden=page.nextCursor===null;status.textContent=page.items.length?`${page.items.length} executions · Core amounts exclude Curve fees/tax or use Pool core deltas · Last 24 completed hours.`:'No executions in this verified range.';
 };
 const load=async(reset:boolean)=>{
  if(!reset&&controller)return;
  const own=++generation;controller?.abort();const abort=new AbortController();controller=abort;
  if(reset){clear();to=Math.floor(Date.now()/3600000)*3600-3600;from=to-86400;}
  if(!id||!baseUrl){status.textContent='Load a market to view executions.';controller=null;return;}
  const identity=id;const prior=page;more.disabled=true;status.textContent='Loading verified executions…';
  const timeout=setTimeout(()=>abort.abort(),10000);
  try{const api=new TickerGardenV1Client(baseUrl,(input,init)=>fetch(input,{...init,signal:abort.signal}));const raw=await api.listMarketTrades({marketId:identity.marketId,from:String(from),to:String(to),limit:50,...(prior?.nextCursor?{cursor:prior.nextCursor}:{})});const next=validateTradePage(raw,chain,identity,from,to,50,prior);if(own!==generation||abort.signal.aborted)return;page=prior?{...next,items:[...prior.items,...next.items]}:next;render();}
  catch(e){if(own!==generation)return;clear();status.textContent=e instanceof TickerGardenApiError&&e.status===409?'Trade history changed. Refresh to restart from the first page.':'Trade history unavailable or incomplete. Try refreshing later.';}
  finally{clearTimeout(timeout);if(own===generation){controller=null;more.disabled=false;}}
 };
 refresh.addEventListener('click',()=>void load(true));more.addEventListener('click',()=>void load(false));status.textContent='Load a market to view executions.';
 return {setMarket(value:CandleIdentity|null){id=value;void load(true);},stop(){generation++;controller?.abort();controller=null;id=null;clear();more.disabled=false;status.textContent='Trade history paused. Load a market to resume.';}};
}
