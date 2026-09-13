import assert from 'node:assert/strict';
import {test} from 'node:test';
import {candleY,candlePriceLabel,comparePrice} from '../src/v1/candles.ts';
test('candle chart preserves large rational ordering and bounded coordinates',()=>{
 const low={numerator:'900719925474099300000000000000000000',denominator:'3'};
 const high={numerator:'900719925474099300000000000000000003',denominator:'3'};
 const mid={numerator:'900719925474099300000000000000000001',denominator:'3'};
 assert.equal(comparePrice(low,high),-1);assert.equal(candleY(low,low,high),210);assert.equal(candleY(high,low,high),10);
 assert.ok(candleY(mid,low,high)>140 && candleY(mid,low,high)<145);
 assert.equal(candleY(low,low,low),110);
 assert.equal(candlePriceLabel({numerator:'10',denominator:'1'}),'10');
 assert.equal(candlePriceLabel({numerator:'1',denominator:'1000000000'}),'<0.00000001');
});
import {validateCandles} from '../src/v1/candles.ts';
const candleIdentity={marketId:`0x${'1'.repeat(64)}` as `0x${string}`,memeAsset:`0x${'2'.repeat(40)}`,quoteAsset:`0x${'3'.repeat(40)}`,quoteDecimals:18};
const makeCandles=(interval:number, count:number)=>Array.from({length:count},(_,i)=>({timestamp:3600+i*interval,open:null,high:null,low:null,close:null,tradeCount:0,internalTradeCount:0,unclassifiedTradeCount:0,memeVolumeRaw:'0',quoteVolumeRaw:'0',internalMemeVolumeRaw:'0',internalQuoteVolumeRaw:'0'}));
const makeWindow=(interval:number, count:number)=>({chainId:4663,displayOnly:true,...candleIdentity,interval,coverage:{from:3600,to:3600+interval*count,anchorNumber:1,throughNumber:2,projectionNumber:2,anchorHash:candleIdentity.marketId,throughHash:candleIdentity.marketId,projectionHash:candleIdentity.marketId},series:{priceUnit:'QUOTE_PER_WHOLE_MEME',volumeBasis:'CURVE_EXCLUDING_FEE_TAX_OR_POOL_CORE',pricePopulation:'ALL_EXECUTIONS_INCLUDING_INTERNAL_CONVERSIONS',emptyPolicy:'NULL_OHLC_ZERO_VOLUME',candles:makeCandles(interval,count)}});
test('candle validation accepts requested 60, 300, and 900 second windows',()=>{
 for (const interval of [60,300,900]) {
  const count=2; const v=makeWindow(interval,count);
  assert.equal(validateCandles(v,4663,candleIdentity,3600,3600+interval*count,interval).series.candles.length,count);
 }
});
test('candle validation rejects a raw interval different from the requested interval',()=>{
 const v=makeWindow(300,2);
 assert.throws(()=>validateCandles(v,4663,candleIdentity,3600,4200,60));
});
test('candle validation rejects false empty bars and identity mismatches',()=>{
 const id={marketId:`0x${'1'.repeat(64)}` as `0x${string}`,memeAsset:`0x${'2'.repeat(40)}`,quoteAsset:`0x${'3'.repeat(40)}`,quoteDecimals:18};
 const v={chainId:4663,displayOnly:true,...id,interval:3600,coverage:{from:3600,to:7200,anchorNumber:1,throughNumber:2,projectionNumber:2,anchorHash:id.marketId,throughHash:id.marketId,projectionHash:id.marketId},series:{priceUnit:'QUOTE_PER_WHOLE_MEME',volumeBasis:'CURVE_EXCLUDING_FEE_TAX_OR_POOL_CORE',pricePopulation:'ALL_EXECUTIONS_INCLUDING_INTERNAL_CONVERSIONS',emptyPolicy:'NULL_OHLC_ZERO_VOLUME',candles:[{timestamp:3600,open:null,high:null,low:null,close:null,tradeCount:0,internalTradeCount:0,unclassifiedTradeCount:0,memeVolumeRaw:'0',quoteVolumeRaw:'0',internalMemeVolumeRaw:'0',internalQuoteVolumeRaw:'0'}]}};
 assert.equal(validateCandles(v,4663,id,3600,7200).series.candles.length,1);
 assert.throws(()=>validateCandles(v,46630,id,3600,7200));
 v.series.candles[0]!.quoteVolumeRaw='1';assert.throws(()=>validateCandles(v,4663,id,3600,7200));
});
import {candleVolume} from '../src/v1/candleTable.ts';
test('candle table formats whole-token volumes without precision loss',()=>{
 assert.equal(candleVolume('1',18),'0.000000000000000001');
 assert.equal(candleVolume('123456700',6),'123.4567');
 assert.equal(candleVolume('900719925474099300000000000000000001',18),'900719925474099300.000000000000000001');
 assert.equal(candleVolume('0',6),'0');
});
