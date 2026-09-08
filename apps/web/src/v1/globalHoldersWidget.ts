import {TickerGardenV1Client} from './generated/read-api.ts';
import {validateGlobalHolders} from './globalHolders.ts';
export function mountGlobalHolders(element:HTMLElement,baseUrl:string|null,chain:number,summaryCount:HTMLElement|null=null){
 let generation=0,controller:AbortController|null=null;
 const status=document.createElement('p');status.setAttribute('role','status');
 const body=document.createElement('div'),refresh=document.createElement('button');refresh.type='button';refresh.textContent='Refresh holders';element.append(status,body,refresh);
 element.style.minWidth='0';element.style.overflowWrap='anywhere';
 const load=async()=>{
  const own=++generation;controller?.abort();controller=new AbortController();const abort=controller;body.replaceChildren();if(summaryCount){summaryCount.textContent='—';summaryCount.removeAttribute('title');}
  if(!baseUrl){status.textContent='Holder statistics unavailable. The data service is not configured.';return;}
  status.textContent='Loading verified holder counts…';const timer=setTimeout(()=>abort.abort(),10000);
  try{
   const api=new TickerGardenV1Client(baseUrl,(input,init)=>fetch(input,{...init,signal:abort.signal}));
   const p=validateGlobalHolders(await api.getGlobalHolderCounts(),chain);if(own!==generation)return;if(abort.signal.aborted)throw new Error('Timeout');
   if(summaryCount){summaryCount.textContent=String(p.positiveAddressCount);summaryCount.title=`Finalized block ${p.sourceBlockNumber} · ${p.sourceBlockHash} · ${p.includedAddressCount} after protocol exclusions`; }
   status.textContent=`${p.positiveAddressCount} distinct holder addresses · ${p.includedAddressCount} after protocol exclusions · ${p.marketCount} markets · ${p.positiveMarketAddressPairs} market-address holdings.`;
   const source=document.createElement('p');source.textContent=`Finalized block ${p.sourceBlockNumber} · ${p.sourceBlockHash}. Addresses are not people or airdrop eligibility. Different Meme Token balances are not added together.`;body.append(source);
   for(const g of p.groups){const row=document.createElement('p');row.textContent=`${g.binding==='unbound'?'No STOCK binding':`STOCK ID ${g.assetUid}`} · ${g.marketCount} markets · ${g.positiveAddressCount} distinct addresses · ${g.includedAddressCount} after exclusions`;body.append(row);}
   if(p.marketCount===0){const empty=document.createElement('p');empty.textContent='No markets in this verified snapshot.';body.append(empty);}
   const details=document.createElement('details'),summary=document.createElement('summary');summary.textContent=`Protocol exclusion addresses (${p.excludedAccounts.length})`;details.append(summary);
   const note=document.createElement('p');note.textContent='The union of known protocol addresses across all markets is excluded from adjusted counts. An address holding tokens in multiple STOCK groups appears in each group but only once globally. Group counts must not be added together.';details.append(note);
   const list=document.createElement('pre');list.style.whiteSpace='pre-wrap';list.style.maxHeight='240px';list.style.overflow='auto';list.textContent=p.excludedAccounts.join('\n')||'None';details.append(list);body.append(details);
  }catch{if(own===generation){body.replaceChildren();status.textContent='Holder statistics unavailable or incomplete. Try refreshing later.';}}
  finally{clearTimeout(timer);if(own===generation)controller=null;}
 };
 refresh.addEventListener('click',()=>void load());void load();return{refresh:load,stop(){generation++;controller?.abort();controller=null;body.replaceChildren();if(summaryCount){summaryCount.textContent='—';summaryCount.removeAttribute('title');}status.textContent='Statistics paused or unavailable. Waiting for a verified snapshot.';}};
}
