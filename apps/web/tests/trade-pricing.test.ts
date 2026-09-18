import assert from 'node:assert/strict';
import {test} from 'node:test';
import {curveBuyFee,curveTradeMetrics,antiSnipeBps,formatTradePrice,estimatedPoolTradingFee,poolTradeImpactBps} from '../src/v1/tradePricing.ts';
test('curve pricing matches the pinned live market quote and keeps tiny prices',()=>{
 const input=1000000000000000n,output=5226157142739982562508148n;
 const fee=curveBuyFee(input,100n,0n);
 assert.equal(fee,10000000000000n);
 const metric=curveTradeMetrics('buy',input,output,input,177900000000000000n,944350758853288364249578415n,fee);
 assert.equal(metric.priceRaw,191345183n);
 assert.ok(metric.impactBps>0n&&metric.impactBps<100n);
 const sell=curveTradeMetrics('sell',1000000000000000000000n,186499361439n,0n,177900000000000000n,944350758853288364249578415n,1883831933n);
 assert.equal(sell.priceRaw,186499361n);
});
test('buy fee uses actual spent for partial fill and rounds each fee separately',()=>{
 assert.equal(curveBuyFee(101n,100n,100n),2n);
 assert.equal(curveBuyFee(100000n,100n,500n,309n),9090n);
 assert.equal(curveBuyFee(100n,100n,0n),1n);
});
test('anti-snipe honors exemptions, five-second expiry and fee cap',()=>{
 assert.equal(antiSnipeBps(0n,false,100n,500n),9300n);
 assert.equal(antiSnipeBps(1n,false,100n,0n),2475n);
 assert.equal(antiSnipeBps(5n,false,100n,0n),0n);
 assert.equal(antiSnipeBps(0n,true,100n,0n),0n);
 assert.throws(()=>antiSnipeBps(-1n,false,100n,0n));
});

test('small prices use subscript zero counts and six significant digits',()=>{
 assert.equal(formatTradePrice('0.000000000191345183'),'0.0₉191345');
 assert.equal(formatTradePrice('0.000001'),'0.0₅1');
 assert.equal(formatTradePrice('1.23456789'),'1.23457');
 assert.equal(formatTradePrice('0'),'0');
});

test('pool trading fee reverses net output and respects output asset raw units',()=>{
 assert.equal(estimatedPoolTradingFee(990n*10n**18n,0),10n*10n**18n);
 assert.equal(estimatedPoolTradingFee(980000n,100),20000n);
 assert.equal(estimatedPoolTradingFee(940000n,500),60000n);
 assert.equal(estimatedPoolTradingFee(0n,0),0n);
 assert.throws(()=>estimatedPoolTradingFee(-1n,0));
 assert.throws(()=>estimatedPoolTradingFee(1n,501));
 // Separate on-chain flooring can make the reverse estimate differ by at
 // most two raw units; never claim the reverse calculation is exact.
 for(const tax of [0,1,100,333,500])for(let gross=1n;gross<2000n;gross++){
  const actual=gross/100n+gross*BigInt(tax)/10000n;
  const estimate=estimatedPoolTradingFee(gross-actual,tax);
  assert.ok(estimate>=actual&&estimate-actual<=2n);
 }
});

test('pool price impact excludes hook and protocol fees in both currency directions',()=>{
 const q96=1n<<96n;
 // 4 currency1 raw units per currency0, with 1% hook fee on output.
 assert.equal(poolTradeImpactBps(10000n,39600n,2n*q96,true,0,0),0n);
 assert.equal(poolTradeImpactBps(10000n,35640n,2n*q96,true,0,0),1000n);
 assert.equal(poolTradeImpactBps(40000n,8910n,2n*q96,false,0,0),1000n);
 // Additional 1% creator tax, plus 0.1% pool protocol fee on input.
 assert.equal(poolTradeImpactBps(1000000n,979020n,q96,true,100,1000),0n);
 assert.equal(poolTradeImpactBps(1000000n,881118n,q96,false,100,1000),1000n);
});
test('pool impact uses raw-unit spot ratios for differing token decimals and tiny quotes',()=>{
 const q96=1n<<96n;
 const net=990000000000000000n;
 assert.equal(poolTradeImpactBps(1000000n,net,1000000n*q96,true,0,0),0n);
 assert.equal(poolTradeImpactBps(1000000000000000000n,990000n,1000000n*q96,false,0,0),0n);
 assert.equal(poolTradeImpactBps(1n,1n,q96,true,0,0),0n);
 assert.throws(()=>poolTradeImpactBps(0n,1n,q96,true,0,0));
 assert.throws(()=>poolTradeImpactBps(1n,1n,0n,true,0,0));
 assert.throws(()=>poolTradeImpactBps(1n,1n,q96,true,0,1001));
});

test('native LP fee is removed from estimated price impact rather than counted as slippage',()=>{
 for(const lp of [0,1000,2000,3000]) {
  const input=1_000_000_000_000n;
  const core=BigInt(lp+1000-Math.floor(lp/1000));
  const gross=input*(1_000_000n-core)/1_000_000n;
  const net=gross-gross/100n;
  assert.equal(poolTradeImpactBps(input,net,1n<<96n,true,0,1000,lp),0n);
 }
});
