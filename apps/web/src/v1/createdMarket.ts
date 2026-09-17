import {erc20Abi,formatUnits,type Hex,type TransactionReceipt} from 'viem';
import curveAbi from './generated/contracts/current/TickerGardenCurve.ts';
import type {MarketOverview} from './marketOverview.ts';
import type {Foundation,ControllerContext} from '../app.ts';
import type {MarketDetailResponse} from './readApi.ts';
import {DirectMarkets} from './directMarkets.ts';

// Only verified receipts seed this short-lived cache. It is never restored from
// browser-supplied market fields, and never changes the finalized directory.
const entries=new Map<string,{foundation:Foundation;request:Promise<MarketDetailResponse>;overview?:MarketOverview;until:number}>();
export function preparedCreatedMarket(id:string){
 const value=entries.get(id);if(!value)return;
 if(value.until<Date.now()){entries.delete(id);return;}
 return value;
}
export async function prepareCreatedMarket(ctx:ControllerContext,receipt:TransactionReceipt):Promise<void>{
 const foundation=ctx.foundation,contracts=ctx.runtimeConfig.contracts;
 if(receipt.status!=='success'||!foundation?.bindings||!contracts.available)return;
 const block=await ctx.publicClient.getBlock({blockNumber:receipt.blockNumber});
 if(block.hash!==receipt.blockHash)throw Error('Creation receipt is no longer canonical');
 const chainId=await ctx.publicClient.getChainId();
 if(chainId!==4663&&chainId!==46630)throw Error('Unsupported creation chain');
 if(chainId!==foundation.sync.chainId)throw Error('Creation chain mismatch');
 const reader=new DirectMarkets({chainId,skipStake:true,releaseId:contracts.value.factoryAddress,factory:contracts.value.factoryAddress,bindings:foundation.bindings,configs:[...foundation.quotes,...foundation.baseline,...foundation.templates]},
  (address,abi,functionName,args,blockNumber)=>ctx.publicClient.readContract({address,abi,functionName,args,blockNumber}),
  async()=>({number:block.number,hash:block.hash}));
 reader.receipt(receipt);
 for(const id of reader.sources.keys()){
  if(entries.size>=20)entries.delete(entries.keys().next().value!);
  const request=reader.market(id).then(async detail=>{
   const canonical=await ctx.publicClient.getBlock({blockNumber:block.number});
   if(canonical.hash!==block.hash)throw Error('Creation reorganized during read');
   return detail;
  });
  const entry:{foundation:Foundation;request:Promise<MarketDetailResponse>;overview?:MarketOverview;until:number}={foundation,request,until:Date.now()+30*60*1000};entries.set(id,entry);
  // Price and total supply do not depend on historical indexing.
  void request.then(async({market})=>{
    if(market.launchPhase!==0)return;
    const quote=foundation.quotes.find(q=>q.id===market.quoteAssetConfigId);
    const decimals=market.quoteAsset==='0x0000000000000000000000000000000000000000'?18:quote?.values.quoteDecimals;
    if(typeof decimals!=='number'||!Number.isInteger(decimals)||decimals<0||decimals>18)return;
    const reserves=await ctx.publicClient.readContract({address:market.curve,abi:curveAbi,functionName:'getReserves',blockNumber:block.number});
    if(reserves[1]===0n)return;
    const supply=await ctx.publicClient.readContract({address:market.memeToken,abi:erc20Abi,functionName:'totalSupply',blockNumber:block.number});
    entry.overview={asOf:Number(block.timestamp),supply:supply.toString(),price:formatUnits(reserves[0]*10n**54n/reserves[1]/10n**BigInt(decimals),36)};
    if(ctx.tradeMarket?.market.marketId===id&&(!ctx.curvePricing||ctx.curvePricing.blockNumber<=block.number))ctx.tokenDetailWidget?.setOverview({...entry.overview,usd:ctx.assetPrices.midpointUsd(market.quoteAsset)??undefined});
  }).catch(()=>{});
  void request.catch(()=>{if(entries.get(id)===entry)entries.delete(id);});
 }
}
