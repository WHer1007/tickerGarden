import type {GlobalStatisticsResponse} from './generated/read-api.ts';
const hash=(v:unknown):v is string=>typeof v==='string'&&/^0x[0-9a-f]{64}$/.test(v);
const address=(v:unknown):v is string=>typeof v==='string'&&/^0x[0-9a-f]{40}$/.test(v);
const integer=(v:unknown):v is number=>Number.isSafeInteger(v)&&Number(v)>=0;
const amount=(v:unknown):v is string=>typeof v==='string'&&/^(0|[1-9][0-9]{0,99})$/.test(v);
const zero='0x'+'0'.repeat(64);
export function validateGlobalStatistics(value:unknown,chain:number,from:number,to:number):GlobalStatisticsResponse{
 const p=value as GlobalStatisticsResponse;const fail=():never=>{throw new Error('Global statistics are inconsistent');};
 if(!p||p.chainId!==chain||p.displayOnly!==true||!p.coverage||p.coverage.from!==from||p.coverage.to!==to||!integer(p.coverage.anchorNumber)||!integer(p.coverage.throughNumber)||!integer(p.coverage.projectionNumber)||p.coverage.anchorNumber>=p.coverage.throughNumber||p.coverage.throughNumber>p.coverage.projectionNumber||![p.coverage.anchorHash,p.coverage.throughHash,p.coverage.projectionHash].every(hash))fail();
 if(![p.marketCount,p.registeredStockCount,p.boundMarketCount,p.unboundMarketCount].every(integer)||p.marketCount>1000||p.boundMarketCount+p.unboundMarketCount!==p.marketCount||!Array.isArray(p.stocks)||p.stocks.length!==p.registeredStockCount||p.stocks.length>1000||!Array.isArray(p.groups)||p.groups.length>1000)fail();
 const stocks=new Set<string>();for(const s of p.stocks){if(!s||!hash(s.assetUid)||s.assetUid===zero||stocks.has(s.assetUid)||!address(s.stockToken)||s.stockToken==='0x'+'0'.repeat(40)||!integer(s.stockDecimals)||s.stockDecimals>18)fail();stocks.add(s.assetUid);}
 const groups=new Set<string>(),precision=new Map<string,number>();let bound=0,unbound=0;
 for(const g of p.groups){
  if(!g||!hash(g.assetUid)||!address(g.quoteAsset)||!integer(g.quoteDecimals)||g.quoteDecimals<6||g.quoteDecimals>18||g.volumeBasis!=='CURVE_EXCLUDING_FEE_TAX_OR_POOL_CORE')fail();
  const key=g.assetUid+':'+g.quoteAsset;if(groups.has(key))fail();groups.add(key);
  const d=precision.get(g.quoteAsset);if(d!==undefined&&d!==g.quoteDecimals)fail();precision.set(g.quoteAsset,g.quoteDecimals);
  if(g.binding==='unbound'&&g.assetUid===zero)unbound+=g.marketCount;else if(g.binding==='registered_stock'&&stocks.has(g.assetUid))bound+=g.marketCount;else fail();
  if(![g.marketCount,g.tradingMarketCount,g.tradeCount,g.internalTradeCount,g.unclassifiedTradeCount,g.unknownFeeTradeCount].every(integer)||g.marketCount===0||g.tradingMarketCount>g.marketCount||g.tradingMarketCount>g.tradeCount||g.internalTradeCount+g.unclassifiedTradeCount!==g.tradeCount||g.unknownFeeTradeCount>g.tradeCount)fail();
  if(!amount(g.quoteVolumeRaw)||!amount(g.internalQuoteVolumeRaw)||BigInt(g.internalQuoteVolumeRaw)>BigInt(g.quoteVolumeRaw)||(g.tradeCount===0&&(g.quoteVolumeRaw!=='0'||g.tradingMarketCount!==0))||(g.tradeCount>0&&(g.quoteVolumeRaw==='0'||g.tradingMarketCount===0))||(g.internalTradeCount===0&&g.internalQuoteVolumeRaw!=='0')||!Array.isArray(g.fees)||g.fees.length>2000)fail();
  const feeAssets=new Set<string>();for(const f of g.fees){if(!f||!address(f.asset)||feeAssets.has(f.asset)||!integer(f.decimals)||f.decimals>18||!amount(f.feeRaw)||!amount(f.taxRaw))fail();const old=precision.get(f.asset);if(old!==undefined&&old!==f.decimals)fail();precision.set(f.asset,f.decimals);feeAssets.add(f.asset);}
 }
 if(bound!==p.boundMarketCount||unbound!==p.unboundMarketCount)fail();return p;
}
