import {formatUnits} from 'viem';
import {parseLog} from '../../chain/src/index.ts';
import {decodeF72Event,f72EventCatalog,type DecodedProtocolEvent} from '../../events/src/index.ts';
import {feeCredits,validateMarket} from '../../analytics-projector/src/index.ts';
import {normalizeTransaction,rebuildHolderSnapshot,transferFromObservation,type EventObservation} from '../../analytics/src/index.ts';

// Seed only what the complete, independently matching creation receipts prove.
// No claim of subsequent trade history or a complete 24-hour interval.
export function creationDetail(receipts:readonly (Record<string,unknown>|null)[],market:Parameters<typeof validateMarket>[0],timestamp:bigint,chainId:4663|46630){
 const logs=receipts.map(receipt=>(receipt!.logs as Record<string,unknown>[]).map(parseLog));
 const stable=(value:unknown)=>JSON.stringify(value,(_key,v)=>typeof v==='bigint'?v.toString():v);
 if(stable(logs[0])!==stable(logs[1]))throw Error('RPC providers disagree on complete launch receipt');
 const origin=logs[0]?.[0];
 if(!origin||logs[0]!.some(log=>log.blockHash!==origin.blockHash||log.blockNumber!==origin.blockNumber||log.transactionHash!==origin.transactionHash||log.transactionIndex!==origin.transactionIndex))throw Error('Creation receipt logs have inconsistent identities');
 const validated=validateMarket(market,chainId);
 const observations:EventObservation[]=[];
 for(const log of logs[0]!){
  if(log.removed)throw Error('Removed creation receipt log');
  const module:DecodedProtocolEvent['module']|undefined=log.address===market.memeToken?'TickerMemeTokenV1':log.address===market.curve?'TickerGardenCurve':
   Object.values(f72EventCatalog).find(item=>'address' in item&&item.address===log.address)?.module as DecodedProtocolEvent['module']|undefined;
  if(!module)continue;
  const event=decodeF72Event(module,log);if(event)observations.push({event,timestamp});
 }
 const trades=normalizeTransaction(observations,[validated.binding]).filter(t=>t.marketId===market.marketId);
 const exclusions=[...new Set([market.curve,market.gauge,market.memeToken,f72EventCatalog.HolderRewardsDistributorV1.address,
  f72EventCatalog.ProtocolFeeVault.address,f72EventCatalog.UniswapV4PoolManager.address,f72EventCatalog.TickerGardenFactoryV1.address,validated.binding.hook])].filter(a=>!/^0x0{40}$/.test(a));
 const holders=rebuildHolderSnapshot({chainId,token:market.memeToken,initialHolder:market.curve,burnAuthority:null,allowSelfBurn:true,initialSupplyRaw:validated.initialSupply,
  transfers:observations.filter(o=>o.event.module==='TickerMemeTokenV1'&&o.event.log.address===market.memeToken&&o.event.eventName==='Transfer').map(o=>transferFromObservation(o,chainId)),excludedAccounts:exclusions});
 const items=holders.balances.filter(b=>!b.excluded).sort((a,b)=>BigInt(a.balanceRaw)>BigInt(b.balanceRaw)?-1:BigInt(a.balanceRaw)<BigInt(b.balanceRaw)?1:a.account.localeCompare(b.account)).map(({account,balanceRaw})=>({account,balanceRaw}));
 const fees=new Map<string,{recipient:'creator'|'platform'|'stakers'|'holders';asset:`0x${string}`;amountRaw:string}>();
 for(const {event} of observations)for(const fee of feeCredits(event)){if(fee.marketId!==market.marketId)continue;const key=`${fee.recipient}:${fee.asset}`;fees.set(key,{recipient:fee.recipient,asset:fee.asset,amountRaw:(BigInt(fees.get(key)?.amountRaw??'0')+fee.amountRaw).toString()});}
 const source={provider:'indexer' as const,asOf:Number(timestamp),blockNumber:market.source.blockNumber,blockHash:logs[0]![0]!.blockHash};
 return {version:1 as const,chainId,displayOnly:true as const,confirmation:'confirmed' as const,marketId:market.marketId,memeToken:market.memeToken,quoteAsset:market.quoteAsset,quoteDecimals:validated.binding.quoteDecimals,
  period:'1H' as const,statistics:{price:trades.length?formatUnits(BigInt(trades.at(-1)!.price.numerator)*10n**36n/BigInt(trades.at(-1)!.price.denominator),36):null,
   volume24h:formatUnits(trades.filter(t=>t.classification==='unclassified').reduce((sum,t)=>sum+BigInt(t.quoteRaw),0n),validated.binding.quoteDecimals),
   volumeFrom:Number(timestamp)-86400,volumeTo:Number(timestamp),volumeBasis:'EXTERNAL_EXECUTIONS_CURVE_EXCLUDING_FEE_TAX_OR_POOL_CORE' as const},chart:null,
  holders:{totalSupplyRaw:holders.totalSupplyRaw,circulatingSupplyRaw:holders.totalSupplyRaw,count:items.length,basis:'CHAIN_TOTAL_SUPPLY_V1' as const,items:items.slice(0,100)},
  trades:trades.map(t=>({timestamp:Number(t.timestamp),side:t.side,price:formatUnits(BigInt(t.price.numerator)*10n**36n/BigInt(t.price.denominator),36),memeRaw:t.memeRaw,quoteRaw:t.quoteRaw,actor:t.actor,txHash:t.source.transactionHash,eventKey:t.source.eventKey,classification:t.classification})),
  fees:[...fees.values()],sources:{statistics:source,holders:source,trades:source,fees:source},reasons:{chart:'Waiting for indexed trade history.'}};
}
