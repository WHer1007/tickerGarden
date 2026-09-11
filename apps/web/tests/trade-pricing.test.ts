import assert from 'node:assert/strict';
import {test} from 'node:test';
import {curveBuyFee,curveTradeMetrics,antiSnipeBps,formatTradePrice} from '../src/v1/tradePricing.ts';
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

test('long decimal prices use compact scientific notation',()=>{
 assert.equal(formatTradePrice('0.000000000191345183'),'1.913e-10');
 assert.equal(formatTradePrice('0.000001'),'0.000001');
 assert.equal(formatTradePrice('1.23456789'),'1.235e+0');
 assert.equal(formatTradePrice('0'),'0');
});
