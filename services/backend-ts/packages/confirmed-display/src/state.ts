import {formatUnits,parseUnits} from 'viem';
import type {MarketReadModel,TokenDetailResponse,TokenDetailTrade,LastBuyReadModel,MarketMetricsReadModel} from '../../../openapi/generated/v1-client.ts';
import {normalizeTransaction,transferFromObservation,type EventObservation} from '../../analytics/src/index.ts';
import {feeCredits,validateMarket} from '../../analytics-projector/src/index.ts';
import {f72EventCatalog} from '../../events/src/index.ts';
import type {MarketCreation} from '../../market-projector/src/index.ts';
import type {RpcBlock} from '../../chain/src/index.ts';
const ZERO=`0x${'0'.repeat(40)}`;
export interface DisplayState {
 creation:MarketCreation; market:MarketReadModel; nextRefreshAt?:string|null;
 quoteUsd?:string|null;
 detailViews?:Record<'1H'|'12H'|'1D',TokenDetailResponse>;
 balances:Record<string,string>; exclusions:string[]; supply:string;
 latestTrade?:TokenDetailTrade|null;
 /** Latest activity is independent of the rolling chart/volume buffer. */
 recentTrades?:TokenDetailTrade[];
 recentTradesHydrated?:boolean;
 latestBuy?:LastBuyReadModel|null;
 quoteUsdAsOf?:string|null;
 quoteUsdSource?:MarketMetricsReadModel['usdPriceSource'];
 trades:TokenDetailTrade[]; fees:NonNullable<TokenDetailResponse['fees']>;
 /** Earliest time for which all executions are known. */
 historyFrom:number; asOf:number; blockNumber:string; blockHash:`0x${string}`;
}
/** Pure incremental reducer. Journal rollback restores the exact predecessor. */
export function applyDisplayEvents(previous:DisplayState,market:MarketReadModel,observations:readonly EventObservation[],block:RpcBlock):DisplayState{
 const next:DisplayState=structuredClone(previous);next.market=market;
 const chain=market.source.chainId;if(chain!==4663&&chain!==46630)throw Error('Invalid display chain');
 const validated=validateMarket(market,chain);
 let supply=BigInt(next.supply);
 const seen=new Set<string>();
 for(const o of observations){
  if(o.event.module!=='TickerMemeTokenV1'||o.event.log.address!==market.memeToken||o.event.eventName!=='Transfer')continue;
  const t=transferFromObservation(o,chain);
  if(seen.has(t.source.eventKey))throw Error('Duplicate display event');seen.add(t.source.eventKey);
  const value=BigInt(t.value);
  if(t.from===ZERO){if(supply!==0n||Object.keys(next.balances).length!==0||value!==BigInt(validated.initialSupply)||t.to!==market.curve)throw Error('Unexpected display mint');supply=value;}
  else{const balance=BigInt(next.balances[t.from]??'0');if(balance<value)throw Error('Display balance underflow');next.balances[t.from]=(balance-value).toString();}
  if(t.to===ZERO)supply-=value;else next.balances[t.to]=(BigInt(next.balances[t.to]??'0')+value).toString();
 }
 if(Object.values(next.balances).reduce((a,b)=>a+BigInt(b),0n)!==supply)throw Error('Display supply mismatch');
 if(market.display&&BigInt(market.display.totalSupplyRaw)!==supply)throw Error('Receipt supply disagrees with block state');
 next.supply=supply.toString();
 const groups=new Map<string,EventObservation[]>();
 for(const o of observations){const key=o.event.log.transactionHash;const group=groups.get(key)??[];group.push(o);groups.set(key,group);}
 const incoming:TokenDetailTrade[]=[];
 for(const group of groups.values())for(const t of normalizeTransaction(group.filter(o=>o.event.module!=='TickerGardenCurve'||o.event.log.address===market.curve),[validated.binding])){
  if(t.marketId!==market.marketId)continue;
  if(t.side==='buy'&&t.classification==='unclassified'&&BigInt(t.memeRaw)>0n&&BigInt(t.quoteRaw)>0n)next.latestBuy={blockNumber:t.source.blockNumber,transactionIndex:String(t.source.transactionIndex),logIndex:String(t.source.logIndex),timestamp:t.timestamp};
  incoming.push({timestamp:Number(t.timestamp),side:t.side,price:formatUnits(BigInt(t.price.numerator)*10n**36n/BigInt(t.price.denominator),36),memeRaw:t.memeRaw,quoteRaw:t.quoteRaw,actor:t.actor,txHash:t.source.transactionHash,eventKey:t.source.eventKey,classification:t.classification});
 }
 const keys=new Set(next.trades.map(t=>t.eventKey));if(incoming.some(t=>keys.has(t.eventKey)))throw Error('Display receipt already applied');
 if(incoming.length)next.latestTrade=incoming.at(-1)!;
 else if(next.latestTrade===undefined&&next.trades.length)next.latestTrade=next.trades[0]!;
 const newest=[...incoming].reverse();
 next.recentTrades=recentDisplayTrades(newest,next.recentTrades??next.trades);
 next.trades=[...newest,...next.trades].filter(t=>t.timestamp>=Number(block.timestamp)-86400);
 const totals=new Map(next.fees.map(f=>[`${f.recipient}:${f.asset}`,{...f}]));
 for(const o of observations)for(const f of feeCredits(o.event)){if(f.marketId!==market.marketId)continue;const key=`${f.recipient}:${f.asset}`,prior=totals.get(key);totals.set(key,{recipient:f.recipient,asset:f.asset,amountRaw:(BigInt(prior?.amountRaw??'0')+f.amountRaw).toString()});}
 next.fees=[...totals.values()];next.asOf=Number(block.timestamp);next.blockNumber=block.number.toString();next.blockHash=block.hash;
 return next;
}
export function emptyDisplayState(creation:MarketCreation,market:MarketReadModel,block:RpcBlock):DisplayState{
 const exclusions=[market.curve,market.gauge,market.memeToken,f72EventCatalog.HolderRewardsDistributorV1.address,f72EventCatalog.ProtocolFeeVault.address,f72EventCatalog.UniswapV4PoolManager.address,f72EventCatalog.TickerGardenFactoryV1.address,market.canonicalRoute?.hook??ZERO].filter(a=>a!==ZERO);
 return{creation,market,balances:{},exclusions,supply:'0',trades:[],fees:[],historyFrom:Number(market.identity?.deployedAt??block.timestamp),asOf:Number(block.timestamp),blockNumber:block.number.toString(),blockHash:block.hash};
}
export function displayDetail(state:DisplayState,period:'1H'|'12H'|'1D',asOf=state.asOf,section?:string,cachedHolders?:TokenDetailResponse['holders']):TokenDetailResponse{
 const selected=new Set(section==='activity'?['trades','fees']:section?.split(',')??['statistics','chart','trades','holders','fees']);
 const chain=state.market.source.chainId;if(chain!==4663&&chain!==46630)throw Error('Invalid display chain');
 const validated=validateMarket(state.market,chain);
 const items=Object.entries(selected.has('holders')&&!cachedHolders?state.balances:{}).filter(([a,b])=>!state.exclusions.includes(a)&&BigInt(b)>0n).map(([account,balanceRaw])=>({account:account as `0x${string}`,balanceRaw})).sort((a,b)=>BigInt(a.balanceRaw)>BigInt(b.balanceRaw)?-1:BigInt(a.balanceRaw)<BigInt(b.balanceRaw)?1:a.account.localeCompare(b.account));
 const source={provider:'indexer' as const,asOf,blockNumber:state.blockNumber,blockHash:state.blockHash};
 const [duration,interval]=({'1H':[3600,60],'12H':[43200,300],'1D':[86400,900]} as const)[period];
 let to=(Math.floor(asOf/interval)+1)*interval,from=to-duration;
 let points:Array<{timestamp:number;price:string|null}>=Array.from({length:duration/interval},(_,i)=>({timestamp:from+i*interval,price:null}));
 for(const t of selected.has('chart')?[...state.trades].reverse():[]){if(t.timestamp<from||t.timestamp>asOf)continue;const point=points[Math.floor((t.timestamp-from)/interval)];if(point)point.price=t.price;}
 // A quiet 1H view shows exactly the last execution at its historical time.
 // Do not carry its price into the current hour or count it in current volume.
 const lastTrade=state.latestTrade??state.trades[0];
 if(period==='1H'&&selected.has('chart')&&!points.some(p=>p.price!==null)&&lastTrade&&lastTrade.timestamp<=asOf){
  to=(Math.floor(lastTrade.timestamp/interval)+1)*interval;from=to-duration;
  points=Array.from({length:duration/interval},(_,i)=>({timestamp:from+i*interval,price:i===duration/interval-1?lastTrade.price:null}));
 }
 const trades=state.trades.filter(t=>t.timestamp>=asOf-86400);
 const volume=selected.has('statistics')&&state.historyFrom<=Math.max(asOf-86400,Number(state.market.identity?.deployedAt??0))?formatUnits(trades.filter(t=>t.classification==='unclassified').reduce((n,t)=>n+BigInt(t.quoteRaw),0n),validated.binding.quoteDecimals):null;
 const result:TokenDetailResponse={version:1,chainId:state.market.source.chainId,displayOnly:true,confirmation:'confirmed',marketId:state.market.marketId,memeToken:state.market.memeToken,quoteAsset:state.market.quoteAsset,quoteDecimals:validated.binding.quoteDecimals,period,
 statistics:{price:state.market.display?.priceQuote??trades[0]?.price??null,...displayUsd(state.market.display?.priceQuote??trades[0]?.price??null,state.supply,state.quoteUsd),volume24h:volume,volumeFrom:asOf-86400,volumeTo:asOf,volumeBasis:'EXTERNAL_EXECUTIONS_CURVE_EXCLUDING_FEE_TAX_OR_POOL_CORE'},chart:{from,to,interval,points},
 holders:cachedHolders??{totalSupplyRaw:state.supply,circulatingSupplyRaw:items.reduce((n,v)=>n+BigInt(v.balanceRaw),0n).toString(),count:items.length,basis:'TOTAL_MINUS_KNOWN_PROTOCOL_BALANCES_V1',items:items.slice(0,100)},trades:(state.recentTrades??state.trades).slice(0,30),fees:state.fees,sources:{statistics:source,chart:source,holders:source,trades:source,fees:source},reasons:{}};
 return {...result,statistics:selected.has('statistics')?result.statistics:null,chart:selected.has('chart')?result.chart:null,trades:selected.has('trades')?result.trades:null,holders:selected.has('holders')?result.holders:null,fees:selected.has('fees')?result.fees:null,sources:Object.fromEntries(Object.entries(result.sources).filter(([key])=>selected.has(key)))};
}

export function recentDisplayTrades(...groups:readonly (readonly TokenDetailTrade[])[]):TokenDetailTrade[]{
 const seen=new Set<string>();
 return groups.flat().filter(t=>{if(seen.has(t.eventKey))return false;seen.add(t.eventKey);return true;}).sort((a,b)=>b.timestamp-a.timestamp).slice(0,30);
}

/** Materialize in the worker. Read endpoints only select stored response fields. */
export function materializeDisplay(state:DisplayState,head={number:state.blockNumber,hash:state.blockHash,timestamp:state.asOf},reuseHolders=false):DisplayState{
 const observed={...state,blockNumber:head.number,blockHash:head.hash};
 const cachedHolders=reuseHolders?state.detailViews?.['1H'].holders:undefined;
 const hour=displayDetail(observed,'1H',head.timestamp,undefined,cachedHolders);
 const metrics=exploreMetrics(hour.statistics!,state.quoteUsd,head.timestamp,state.quoteUsdAsOf??null,state.quoteUsdSource??null);
 const {lastBuy:oldBuy,...baseMarket}=state.market;
 return {...state,market:{...baseMarket,metrics,...(state.latestBuy?{lastBuy:state.latestBuy}:{})},detailViews:{'1H':hour,'12H':displayDetail(observed,'12H',head.timestamp,undefined,hour.holders),'1D':displayDetail(observed,'1D',head.timestamp,undefined,hour.holders)}};
}

export function displayUsd(price:string|null,supply:string,usd:string|null|undefined):{priceUsd:string|null;marketCapUsd:string|null}{
 if(!price||!usd)return {priceUsd:null,marketCapUsd:null};
 const product=parseUnits(price,36)*parseUnits(usd,36);
 return {priceUsd:formatUnits(product/10n**36n,36),marketCapUsd:formatUnits(product*BigInt(supply)/10n**54n,36)};
}

/** Current-price USD estimate, materialized once by the worker, never by readers. */
export function exploreMetrics(stat:NonNullable<TokenDetailResponse['statistics']>,usd:string|null|undefined,asOf:number,usdAsOf:string|null=null,usdSource:MarketMetricsReadModel['usdPriceSource']=null):MarketMetricsReadModel{
 const volume=stat.volume24h===null?null:stat.volume24h==='0'?'0':usd?formatUnits(parseUnits(stat.volume24h,36)*parseUnits(usd,36)/10n**36n,36):null;
 return {status:stat.marketCapUsd!=null?'available':'unavailable',reason:stat.marketCapUsd==null?'valuation_inputs_unavailable':'',marketCapUsd:stat.marketCapUsd??null,volume24hUsd:volume,quoteUsdMidpoint:usd??null,windowFromTimestamp:String(Math.max(0,asOf-86400)),asOfTimestamp:String(asOf),usdPriceAsOf:usdAsOf,usdPriceSource:usdSource,volumeBasis:'EXTERNAL_EXECUTIONS_CURVE_EXCLUDING_FEE_TAX_OR_POOL_CORE',marketCapBasis:'TOTAL_SUPPLY_X_POOL_SPOT_X_QUOTE_USD'};
}
