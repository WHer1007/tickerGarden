import {TickerGardenV1Client,TickerGardenApiError,type MarketHoldersResponse} from './generated/read-api.ts';
import {validateHolderPage,type HolderIdentity} from './holders.ts';
import {candleVolume} from './candleTable.ts';
export function mountHolders(element:HTMLElement,baseUrl:string|null,chain:number,onSummary?:(page:MarketHoldersResponse|null)=>void){
 let id:HolderIdentity|null=null,page:MarketHoldersResponse|null=null,controller:AbortController|null=null,generation=0;
 const status=document.createElement('p');status.setAttribute('role','status');const list=document.createElement('div');list.style.overflow='auto';list.style.maxHeight='480px';list.tabIndex=0;list.setAttribute('role','region');list.setAttribute('aria-label','Holder balances');element.style.minWidth='0';
 const refresh=document.createElement('button');refresh.type='button';refresh.textContent='Refresh holders';const more=document.createElement('button');more.type='button';more.textContent='Load more';more.hidden=true;element.append(status,list,refresh,more);
 const clear=()=>{page=null;onSummary?.(null);list.replaceChildren();more.hidden=true;};
 const render=()=>{
  list.replaceChildren();if(!page)return;onSummary?.(page);
  const table=document.createElement('table');const caption=table.createCaption();caption.textContent=`Finalized block ${page.sourceBlockNumber} · ${page.sourceBlockHash}`;
  const head=table.createTHead().insertRow();for(const name of ['Address','Token balance','Address classification']){const th=document.createElement('th');th.scope='col';th.textContent=name;head.append(th);}
  const body=table.createTBody();for(const b of page.balances){const row=body.insertRow();for(const text of [b.account,candleVolume(b.balanceRaw,18),b.excluded?'Known protocol address · excluded from adjusted count':'Included address · user identity unverified'])row.insertCell().textContent=text;}
  for(const cell of table.querySelectorAll('th,td')){(cell as HTMLElement).style.padding='8px';(cell as HTMLElement).style.whiteSpace='nowrap';}
  const exclusions=document.createElement('details');const summary=document.createElement('summary');summary.textContent='Excluded protocol addresses';const names=document.createElement('p');names.style.overflowWrap='anywhere';names.textContent=page.excludedAccounts.join(' · ')||'None';exclusions.append(summary,names);
  list.append(table,exclusions);more.hidden=page.nextCursor===null;status.textContent=`${page.balances.length} of ${page.positiveAddressCount} positive-balance addresses loaded · ${page.includedAddressCount} after protocol exclusions · Token supply: ${candleVolume(page.totalSupplyRaw,18)}. Address counts are not user counts or reward eligibility.`;
 };
 const load=async(reset:boolean)=>{
  if(!reset&&controller)return;
  const own=++generation;controller?.abort();const abort=new AbortController();controller=abort;if(reset)clear();
  if(!id||!baseUrl){status.textContent='Load a market to view holder balances.';controller=null;return;}
  const identity=id,prior=page;more.disabled=true;status.textContent='Loading finalized holder balances…';const timeout=setTimeout(()=>abort.abort(),10000);
  try{const api=new TickerGardenV1Client(baseUrl,(input,init)=>fetch(input,{...init,signal:abort.signal}));const raw=await api.listMarketHolders({marketId:identity.marketId,limit:50,...(prior?.nextCursor?{cursor:prior.nextCursor}:{})});const next=validateHolderPage(raw,chain,identity,50,prior);if(own!==generation)return;if(abort.signal.aborted)throw new Error("Holder request timed out");page=prior?{...next,balances:[...prior.balances,...next.balances]}:next;render();}
  catch(e){if(own!==generation)return;clear();status.textContent=e instanceof TickerGardenApiError&&e.status===409?'Holder snapshot changed. Refresh to restart from the first page.':'Holder balances unavailable or incomplete. Try refreshing later.';}
  finally{clearTimeout(timeout);if(own===generation){controller=null;more.disabled=false;}}
 };
 refresh.addEventListener('click',()=>void load(true));more.addEventListener('click',()=>void load(false));status.textContent='Load a market to view holder balances.';
 return {setMarket(value:HolderIdentity|null){id=value;void load(true);},stop(){generation++;controller?.abort();controller=null;id=null;clear();more.disabled=false;status.textContent='Holder balances paused. Load a market to resume.';}};
}
