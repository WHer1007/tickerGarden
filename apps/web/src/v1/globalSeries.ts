import type {GlobalFlowSeriesResponse} from './generated/read-api.ts';
const hash=(v:unknown)=>typeof v==='string'&&/^0x[0-9a-f]{64}$/.test(v);
const address=(v:unknown)=>typeof v==='string'&&/^0x[0-9a-f]{40}$/.test(v);
const count=(v:unknown)=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0;
const amount=(v:unknown)=>typeof v==='string'&&/^(0|[1-9][0-9]{0,99})$/.test(v);
export function validateGlobalSeries(value:unknown,chain:number,from:number,to:number):GlobalFlowSeriesResponse{
 const p=value as GlobalFlowSeriesResponse;const fail=():never=>{throw new Error('Inconsistent flow series');};
 if(!p||p.chainId!==chain||p.displayOnly!==true||p.interval!==3600||to-from!==86400||from%3600!==0||p.volumeBasis!=='CURVE_EXCLUDING_FEE_TAX_OR_POOL_CORE'||p.emptyPolicy!=='ZERO_FLOW_NO_SYNTHETIC_EXECUTIONS'||!p.coverage)fail();
 const c=p.coverage;if(c.from!==from||c.to!==to||![c.anchorNumber,c.throughNumber,c.projectionNumber].every(count)||c.anchorNumber>=c.throughNumber||c.throughNumber>c.projectionNumber||![c.anchorHash,c.throughHash,c.projectionHash].every(hash)||!Array.isArray(p.points)||p.points.length!==24)fail();
 let identity:string|null=null;const decimals=new Map<string,number>();
 for(const [i,point] of p.points.entries()){
  if(!point||point.timestamp!==from+i*3600||!Array.isArray(point.groups)||point.groups.length>1000)fail();
  const keys:string[]=[];const unique=new Set<string>();
  for(const g of point.groups){
   if(!g||!hash(g.assetUid)||!address(g.quoteAsset)||!count(g.quoteDecimals)||g.quoteDecimals<6||g.quoteDecimals>18||(g.quoteAsset==='0x'+'0'.repeat(40)&&g.quoteDecimals!==18))fail();
   const unbound=g.assetUid==='0x'+'0'.repeat(64);if(g.binding!==(unbound?'unbound':'registered_stock'))fail();
   const key=g.assetUid+':'+g.quoteAsset;if(unique.has(key))fail();unique.add(key);keys.push(key+':'+g.quoteDecimals);
   const old=decimals.get(g.quoteAsset);if(old!==undefined&&old!==g.quoteDecimals)fail();decimals.set(g.quoteAsset,g.quoteDecimals);
   if(![g.tradeCount,g.internalTradeCount,g.unclassifiedTradeCount,g.unknownFeeTradeCount].every(count)||g.tradeCount!==g.internalTradeCount+g.unclassifiedTradeCount||g.unknownFeeTradeCount>g.tradeCount||!amount(g.quoteVolumeRaw)||!amount(g.internalQuoteVolumeRaw)||BigInt(g.internalQuoteVolumeRaw)>BigInt(g.quoteVolumeRaw)||(g.internalTradeCount===0&&g.internalQuoteVolumeRaw!=='0')||(g.tradeCount===0&&g.quoteVolumeRaw!=='0')||(g.tradeCount>0&&g.quoteVolumeRaw==='0')||!Array.isArray(g.fees)||g.fees.length>2000||(g.tradeCount===0&&g.fees.length!==0))fail();
   const feeAssets=new Set<string>();for(const f of g.fees){if(!f||!address(f.asset)||feeAssets.has(f.asset)||!count(f.decimals)||f.decimals>18||!amount(f.feeRaw)||!amount(f.taxRaw))fail();const prior=decimals.get(f.asset);if(prior!==undefined&&prior!==f.decimals)fail();decimals.set(f.asset,f.decimals);feeAssets.add(f.asset);}
  }
  const next=JSON.stringify(keys.sort());if(identity!==null&&identity!==next)fail();identity=next;
 }
 return p;
}
