import type {MarketTradesResponse,TradeActivity} from './generated/read-api.ts';
import type {CandleIdentity} from './candles.ts';
const object=(v:unknown):v is Record<string,unknown>=>typeof v==='object'&&v!==null&&!Array.isArray(v);
const uint=(v:unknown):v is string=>typeof v==='string'&&/^(0|[1-9][0-9]{0,99})$/.test(v);
const hash=(v:unknown)=>typeof v==='string'&&/^0x[0-9a-f]{64}$/.test(v);
const address=(v:unknown)=>typeof v==='string'&&/^0x[0-9a-f]{40}$/.test(v);
const integer=(v:unknown):v is number=>Number.isSafeInteger(v)&&Number(v)>=0;
export function tradeOrder(a:TradeActivity,b:TradeActivity):number {
 const x=BigInt(a.source.blockNumber),y=BigInt(b.source.blockNumber);
 if(x!==y)return x>y?-1:1;
 if(a.source.transactionIndex!==b.source.transactionIndex)return a.source.transactionIndex>b.source.transactionIndex?-1:1;
 return a.source.logIndex>b.source.logIndex?-1:a.source.logIndex<b.source.logIndex?1:0;
}
export function validateTradePage(raw:unknown,chain:number,id:CandleIdentity,from:number,to:number,limit:number,previous:MarketTradesResponse|null=null):MarketTradesResponse{
 const fail=():never=>{throw new Error('Trade history is unavailable or inconsistent');};
 if(!object(raw)||raw.chainId!==chain||raw.displayOnly!==true||raw.marketId!==id.marketId||raw.memeAsset!==id.memeAsset||raw.quoteAsset!==id.quoteAsset||raw.quoteDecimals!==id.quoteDecimals||!object(raw.coverage)||!Array.isArray(raw.items)||raw.items.length>limit||typeof raw.revision!=='string'||!/^sha256:[0-9a-f]{64}$/.test(raw.revision)||(raw.nextCursor!==null&&(typeof raw.nextCursor!=='string'||raw.nextCursor.length===0||raw.nextCursor.length>2048)))return fail();
 const c=raw.coverage;
 if(c.from!==from||c.to!==to||!integer(c.anchorNumber)||!integer(c.throughNumber)||!integer(c.projectionNumber)||c.anchorNumber>=c.throughNumber||c.throughNumber>c.projectionNumber||!hash(c.anchorHash)||!hash(c.throughHash)||!hash(c.projectionHash))return fail();
 if(previous&&(previous.revision!==raw.revision||JSON.stringify(previous.coverage)!==JSON.stringify(c)||raw.nextCursor===previous.nextCursor&&raw.nextCursor!==null))return fail();
 if(raw.nextCursor!==null&&raw.items.length!==limit)return fail();
 const seen=new Set(previous?.items.map(t=>t.source.eventKey));let last=previous?.items.at(-1);
 for(const x of raw.items){
  if(!object(x)||!object(x.source)||!object(x.price)||x.marketId!==id.marketId||x.memeAsset!==id.memeAsset||x.quoteAsset!==id.quoteAsset||x.quoteDecimals!==id.quoteDecimals||!uint(x.timestamp)||BigInt(x.timestamp)<BigInt(from)||BigInt(x.timestamp)>=BigInt(to)||!uint(x.memeRaw)||x.memeRaw==='0'||!uint(x.quoteRaw)||x.quoteRaw==='0'||!uint(x.price.numerator)||x.price.numerator==='0'||!uint(x.price.denominator)||x.price.denominator==='0'||x.priceUnit!=='QUOTE_PER_WHOLE_MEME'||typeof x.side!=='string'||!['buy','sell'].includes(x.side)||typeof x.classification!=='string'||!['unclassified','internal_reward_conversion','internal_holder_conversion'].includes(x.classification))return fail();
  const p=x.source;
  if(p.chainId!==chain||!uint(p.blockNumber)||!hash(p.blockHash)||!hash(p.transactionHash)||!address(p.emitter)||!integer(p.transactionIndex)||!integer(p.logIndex)||p.eventKey!==`${chain}:${p.transactionHash}:${p.logIndex}`||seen.has(String(p.eventKey)))return fail();
  if(BigInt(p.blockNumber)<BigInt(c.anchorNumber)||BigInt(p.blockNumber)>BigInt(c.throughNumber))return fail();
  if(BigInt(x.price.numerator)*BigInt(x.memeRaw)*10n**BigInt(id.quoteDecimals)!==BigInt(x.price.denominator)*BigInt(x.quoteRaw)*10n**18n)return fail();
  for(const field of ['feeRaw','taxRaw'])if(x[field]!==null&&!uint(x[field]))return fail();
  if(x.venue==='curve'){
   if(x.amountBasis!=='CURVE_EXCLUDING_FEE_TAX'||x.actorConfidence!=='contract_caller_not_verified_wallet'||!address(x.actor)||!address(x.recipient)||x.feeStatus!=='event_reported'||x.feeRaw===null||x.taxRaw===null||x.feeAsset!==id.quoteAsset||x.classification!=='unclassified')return fail();
  }else if(x.venue==='pool'){
   if(x.amountBasis!=='POOL_CORE'||x.recipient!==null||x.taxRaw!==null)return fail();
   if(!((x.actor===null&&x.actorConfidence==='unavailable')||(address(x.actor)&&x.actorConfidence==='contract_caller_not_verified_wallet')))return fail();
   if(x.feeStatus==='not_provided'){if(x.feeRaw!==null||x.feeAsset!==null)return fail();}else if(x.feeStatus!=='paired_event'||!uint(x.feeRaw)||(x.feeAsset!==id.memeAsset&&x.feeAsset!==id.quoteAsset))return fail();
  }else return fail();
  const trade=x as unknown as TradeActivity;
  if(last&&(tradeOrder(last,trade)>=0||BigInt(last.timestamp)<BigInt(trade.timestamp)))return fail();
  seen.add(String(p.eventKey));last=trade;
 }
 return raw as unknown as MarketTradesResponse;
}
