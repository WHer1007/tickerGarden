import {decodeEventLog,formatUnits,toEventSelector,type Hex} from 'viem';
import {v1Abis} from './generated/abis.ts';
import {poolSwapAbi} from './poolTrade.ts';
import type {MarketReadModel,TokenDetailTrade} from './generated/read-api.ts';
type TradeLog={address:string;topics:readonly Hex[];data:Hex;transactionHash:Hex;logIndex:number};
export function decodeRecentTrade(log:TradeLog,market:MarketReadModel,decimals:number,timestamp:number,poolManager?:string):TokenDetailTrade|null{
 try{
  let side:'buy'|'sell',meme:bigint,quote:bigint,actor:Hex;
  if(log.address.toLowerCase()===market.curve.toLowerCase()){
   const event=decodeEventLog({abi:v1Abis.TickerGardenCurve,topics:log.topics as [Hex,...Hex[]],data:log.data});
   if(event.eventName==='CurveBuy'){side='buy';meme=event.args.tokensOut;quote=event.args.quoteIn;actor=event.args.buyer;}
   else if(event.eventName==='CurveSell'){side='sell';meme=event.args.tokensIn;quote=event.args.quoteOut;actor=event.args.seller;}
   else return null;
  }else if(poolManager&&log.address.toLowerCase()===poolManager.toLowerCase()&&market.poolKey){
   const event=decodeEventLog({abi:poolSwapAbi,topics:log.topics as [Hex,...Hex[]],data:log.data});
   if(event.args.id.toLowerCase()!==market.poolId?.toLowerCase())return null;
   // Graduation can perform internal reward conversions through the same
   // manager. They are protocol bookkeeping, not market trades.
   if(String(event.args.sender).toLowerCase()===market.canonicalRoute.hook.toLowerCase())return null;
   const meme0=market.poolKey.currency0.toLowerCase()===market.memeToken.toLowerCase();
   const m=meme0?event.args.amount0:event.args.amount1,q=meme0?event.args.amount1:event.args.amount0;
   if(m===0n||q===0n||(m>0n)===(q>0n))return null;
   side=m>0n?'buy':'sell';meme=m<0n?-m:m;quote=q<0n?-q:q;actor=event.args.sender;
  }else return null;
  if(meme<=0n||quote<=0n||!Number.isSafeInteger(timestamp)||timestamp<=0)return null;
  return {timestamp,side,memeRaw:meme.toString(),quoteRaw:quote.toString(),price:formatUnits(quote*10n**36n/meme,decimals+18),actor,txHash:log.transactionHash,eventKey:`${log.transactionHash.toLowerCase()}:${log.logIndex}`,classification:'unclassified'};
 }catch{return null;}
}
export function mergeRecentTrades(...groups:ReadonlyArray<readonly TokenDetailTrade[]>):TokenDetailTrade[]{
 const rows=new Map<string,TokenDetailTrade>();for(const group of groups)for(const row of group){const index=row.eventKey.split(':').at(-1);rows.set(`${row.txHash.toLowerCase()}:${index}`,row);}
 return [...rows.values()].sort((a,b)=>b.timestamp-a.timestamp||Number(b.eventKey.split(':').at(-1))-Number(a.eventKey.split(':').at(-1))).slice(0,100);
}
export async function explorerRecentTrades(explorer:string,market:MarketReadModel,decimals:number,poolManager?:string,poolCreatedBlock?:number|string):Promise<TokenDetailTrade[]>{
 const response=await fetch(`${explorer}/api/v2/addresses/${market.curve}/logs`,{signal:AbortSignal.timeout(8000)});
 if(!response.ok)throw Error('Recent Trades Unavailable');
 const page=await response.json();if(!Array.isArray(page.items))throw Error('Invalid Trade Response');
 const curveTrades=page.items.flatMap((item:any)=>{
  if(!/^0x[0-9a-f]{64}$/i.test(item.transaction_hash)||!Number.isSafeInteger(item.index)||!Array.isArray(item.topics))return [];
  const row=decodeRecentTrade({address:item.address?.hash??'',topics:item.topics.filter(Boolean),data:item.data,transactionHash:item.transaction_hash,logIndex:item.index},market,decimals,Math.floor(Date.parse(item.block_timestamp)/1000));
  return row?[row]:[];
 });
 if(!poolManager||!market.poolId||!market.poolKey||poolCreatedBlock===undefined)return mergeRecentTrades(curveTrades);
 // Blockscout's legacy logs endpoint supports indexed topic filtering and is
 // bounded to one request here; this avoids an unbounded RPC log scan.
 const params=new URLSearchParams({module:'logs',action:'getLogs',address:poolManager,fromBlock:String(poolCreatedBlock),toBlock:'latest',page:'1',offset:'1000',topic0:toEventSelector('Swap(bytes32,address,int128,int128,uint160,uint128,int24,uint24)'),topic1:market.poolId,topic0_1_opr:'and',sort:'desc'});
 let poolItems:any[];
 try {
  const poolResponse=await fetch(`${explorer}/api?${params}`,{signal:AbortSignal.timeout(8000)});
  if(!poolResponse.ok)throw Error('Recent Trades Unavailable');
  const poolPage=await poolResponse.json();
  if(!Array.isArray(poolPage.result)&&!Array.isArray(poolPage.items))throw Error('Invalid Trade Response');
  poolItems=Array.isArray(poolPage.result)?poolPage.result:poolPage.items;
 } catch { return mergeRecentTrades(curveTrades); }
 const poolTrades=poolItems.flatMap((item:any)=>{
  const hash=item.transactionHash??item.transaction_hash;
  const index=Number(item.logIndex??item.index);
  const topics=Array.isArray(item.topics)?item.topics.filter(Boolean):[];
  if(!/^0x[0-9a-f]{64}$/i.test(hash)||!Number.isSafeInteger(index)||!topics.length)return [];
  const rawTimestamp=item.timeStamp??item.timestamp??item.block_timestamp;
  const timestamp=typeof rawTimestamp==='string'&&/^0x[0-9a-f]+$/i.test(rawTimestamp)?Number.parseInt(rawTimestamp,16):Math.floor(Date.parse(rawTimestamp)/1000);
  const address=typeof item.address==='string'?item.address:item.address?.hash??poolManager;
  const row=decodeRecentTrade({address,topics,data:item.data,transactionHash:hash,logIndex:index},market,decimals,timestamp,poolManager);
  return row?[row]:[];
 });
 return mergeRecentTrades(curveTrades,poolTrades);
}

export function curveVolumeAmount(log:{topics:readonly Hex[];data:Hex}):bigint|null{
 if(![toEventSelector('CurveBuy(address,address,uint256,uint256,uint256,uint256)'),toEventSelector('CurveSell(address,address,uint256,uint256,uint256,uint256)')].includes(log.topics[0]!))return null;
 const event=decodeEventLog({abi:v1Abis.TickerGardenCurve,topics:log.topics as [Hex,...Hex[]],data:log.data});
 if(event.eventName==='CurveBuy')return event.args.quoteIn-event.args.fee-event.args.tax;
 if(event.eventName==='CurveSell')return event.args.quoteOut+event.args.fee+event.args.tax;
 return null;
}
const volumeCache=new Map<string,{at:number;value:string;trades:TokenDetailTrade[]}>();
export async function explorerCurveVolume24h(explorer:string,market:MarketReadModel,decimals:number,onTrades?:(trades:TokenDetailTrade[])=>void):Promise<string>{
 // A curve-only window cannot represent a market that has moved to a pool.
 if(market.launchPhase!==0)throw Error('Pool Volume Requires Complete Pool Coverage');
 const key=`${explorer}:${market.marketId}`,saved=volumeCache.get(key),now=Date.now();
 if(saved&&now-saved.at<600000){onTrades?.(saved.trades);return saved.value;}
 const cutoff=Math.floor(now/1000)-86400,until=Math.floor(now/1000),seen=new Set<string>(),cursors=new Set<string>();let total=0n;const trades:TokenDetailTrade[]=[];
 let url=new URL(`${explorer}/api/v2/addresses/${market.curve}/logs`);
 for(let pageNumber=0;pageNumber<20;pageNumber++){
  const response=await fetch(url,{signal:AbortSignal.timeout(8000)});if(!response.ok)throw Error('Volume Unavailable');
  const page=await response.json();if(!Array.isArray(page.items))throw Error('Invalid Volume Page');
  let crossed=false;
  for(const item of page.items){
   if(item.address?.hash?.toLowerCase()!==market.curve.toLowerCase())throw Error('Wrong Volume Contract');
   const timestamp=Math.floor(Date.parse(item.block_timestamp)/1000);if(!Number.isSafeInteger(timestamp))throw Error('Invalid Volume Time');
   if(timestamp<cutoff){crossed=true;continue;}if(timestamp>until)continue;
   const id=`${item.transaction_hash}:${item.index}`;if(seen.has(id))continue;seen.add(id);
   const row=decodeRecentTrade({address:item.address.hash,topics:item.topics.filter(Boolean),data:item.data,transactionHash:item.transaction_hash,logIndex:item.index},market,decimals,timestamp);if(row)trades.push(row);
   const value=curveVolumeAmount({topics:item.topics.filter(Boolean),data:item.data});if(value!==null){if(value<0n)throw Error('Invalid Volume Amount');total+=value;}
  }
  if(crossed||page.next_page_params===null){const value=formatUnits(total,decimals);volumeCache.set(key,{at:now,value,trades});onTrades?.(trades);return value;}
  if(!page.next_page_params||!page.items.length)throw Error('Incomplete Volume Coverage');
  const cursor=JSON.stringify(page.next_page_params);if(cursors.has(cursor))throw Error('Repeated Volume Page');cursors.add(cursor);
  url=new URL(`${explorer}/api/v2/addresses/${market.curve}/logs`);for(const [name,value]of Object.entries(page.next_page_params))url.searchParams.set(name,String(value));
 }
 throw Error('Volume Window Is Incomplete');
}
