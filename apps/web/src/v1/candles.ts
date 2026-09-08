import type { MarketCandlesResponse, CandlePrice } from './generated/read-api.ts';

export type CandleIdentity = { marketId: `0x${string}`; memeAsset: string; quoteAsset: string; quoteDecimals: number };
const obj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const uint = (v: unknown): v is string => typeof v === 'string' && /^(0|[1-9][0-9]{0,99})$/.test(v);
const integer = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) >= 0;
const hash = (v: unknown) => typeof v === 'string' && /^0x[0-9a-f]{64}$/.test(v);
const price = (v: unknown): v is CandlePrice => obj(v) && uint(v.numerator) && uint(v.denominator) && v.numerator !== '0' && v.denominator !== '0';
export const comparePrice = (a: CandlePrice, b: CandlePrice) => {
 const x = BigInt(a.numerator)*BigInt(b.denominator)-BigInt(b.numerator)*BigInt(a.denominator);
 return x<0n?-1:x>0n?1:0;
};
export function validateCandles(v: unknown, chain: number, id: CandleIdentity, from: number, to: number): MarketCandlesResponse {
 const fail = (): never => { throw new Error('Candle data is unavailable or inconsistent'); };
 if (!obj(v) || v.chainId!==chain || v.displayOnly!==true || v.marketId!==id.marketId || v.memeAsset!==id.memeAsset || v.quoteAsset!==id.quoteAsset || v.quoteDecimals!==id.quoteDecimals || v.interval!==3600 || !obj(v.coverage) || !obj(v.series)) return fail();
 const c=v.coverage,s=v.series;
 if (c.from!==from || c.to!==to || !integer(c.anchorNumber) || !integer(c.throughNumber) || !integer(c.projectionNumber) || c.anchorNumber>=c.throughNumber || c.throughNumber>c.projectionNumber || !hash(c.anchorHash) || !hash(c.throughHash) || !hash(c.projectionHash) || s.priceUnit!=='QUOTE_PER_WHOLE_MEME' || s.volumeBasis!=='CURVE_EXCLUDING_FEE_TAX_OR_POOL_CORE' || s.pricePopulation!=='ALL_EXECUTIONS_INCLUDING_INTERNAL_CONVERSIONS' || s.emptyPolicy!=='NULL_OHLC_ZERO_VOLUME' || !Array.isArray(s.candles) || s.candles.length!==(to-from)/3600 || s.candles.length>48) return fail();
 for (const [i,x] of s.candles.entries()) {
  if (!obj(x) || x.timestamp!==from+i*3600 || !integer(x.tradeCount) || !integer(x.internalTradeCount) || !integer(x.unclassifiedTradeCount) || x.tradeCount!==x.internalTradeCount+x.unclassifiedTradeCount) return fail();
  if (!uint(x.memeVolumeRaw) || !uint(x.quoteVolumeRaw) || !uint(x.internalMemeVolumeRaw) || !uint(x.internalQuoteVolumeRaw) || BigInt(x.internalMemeVolumeRaw)>BigInt(x.memeVolumeRaw) || BigInt(x.internalQuoteVolumeRaw)>BigInt(x.quoteVolumeRaw)) return fail();
  if (x.internalTradeCount===0 && (x.internalMemeVolumeRaw!=='0' || x.internalQuoteVolumeRaw!=='0')) return fail();
  if (x.tradeCount===0) { if ([x.open,x.high,x.low,x.close].some(p=>p!==null) || x.memeVolumeRaw!=='0' || x.quoteVolumeRaw!=='0') return fail(); }
  else if (!price(x.open) || !price(x.high) || !price(x.low) || !price(x.close) || x.memeVolumeRaw==='0' || x.quoteVolumeRaw==='0' || comparePrice(x.low,x.open)>0 || comparePrice(x.low,x.close)>0 || comparePrice(x.high,x.open)<0 || comparePrice(x.high,x.close)<0) return fail();
 }
 return v as unknown as MarketCandlesResponse;
}

// Convert only the bounded screen coordinate to Number, never the raw price.
export function candleY(p: CandlePrice, low: CandlePrice, high: CandlePrice): number {
 if (comparePrice(low,high)===0) return 110;
 const n=BigInt(p.numerator)*BigInt(low.denominator)-BigInt(low.numerator)*BigInt(p.denominator);
 const d=BigInt(high.numerator)*BigInt(low.denominator)-BigInt(low.numerator)*BigInt(high.denominator);
 return 210-Number(n*BigInt(high.denominator)*2000n/(d*BigInt(p.denominator)))/10;
}
export function candlePriceLabel(p: CandlePrice): string {
 const n=BigInt(p.numerator),d=BigInt(p.denominator),scaled=n*100000000n/d;
 if (scaled===0n) return '<0.00000001';
 return `${scaled/100000000n}.${(scaled%100000000n).toString().padStart(8,'0')}`.replace(/\.?0+$/,'');
}
