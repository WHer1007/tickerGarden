import {formatUnits} from 'viem';
import type {CandleIdentity} from './candles.ts';
import {integrationFeed} from './integrationFeed.ts';
export function mountDirectTrades(element:HTMLElement,base:string|null){
 let id:CandleIdentity|null=null,stopped=false,generation=0;
 const status=document.createElement('p'),list=document.createElement('div'),button=document.createElement('button');status.setAttribute('role','status');button.textContent='Refresh trades';button.type='button';element.append(status,list,button);
 async function refresh(){const own=generation;if(stopped||document.hidden||!id||!base)return;const identity=id;
  try{const root=await integrationFeed(base);const feed=await integrationFeed(base,`${root.scope}:${identity.marketId}`);if(own!==generation)return;
   list.replaceChildren();const rows=feed.events.filter(e=>e.payload.event.signature.startsWith('CurveBuy(')||e.payload.event.signature.startsWith('CurveSell('));
   for(const event of rows){const a=event.payload.event.args,buy=event.payload.event.signature.startsWith('CurveBuy(');const row=document.createElement('p');row.textContent=`Block ${event.blockNumber} · ${buy?'Buy':'Sell'} · ${formatUnits(BigInt(buy?a.tokensOut!:a.tokensIn!),18)} token · ${formatUnits(BigInt(buy?a.quoteIn!:a.quoteOut!),identity.quoteDecimals)} paired asset`;list.append(row);}
   status.textContent=feed.stale?'Latest observations are updating; displayed transactions are provisional.':rows.length?'Latest contract executions · final confirmation pending.':'No Curve executions in the observed session range.';
  }catch{if(own===generation)status.textContent='Latest executions are not available yet. Trading does not wait for this list.';}
 }
 button.onclick=()=>void refresh();const timer=setInterval(()=>void refresh(),5_000);
 return {setMarket(value:CandleIdentity|null){id=value;generation++;list.replaceChildren();status.textContent=value?'Loading latest executions…':'Select a market.';void refresh();},stop(){stopped=true;generation++;clearInterval(timer);list.replaceChildren();}};
}
