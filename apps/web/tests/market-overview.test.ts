import {test} from 'node:test';
import assert from 'node:assert/strict';
import {marketCapUsd,poolSpotPrice} from '../src/v1/marketOverview.ts';
test('USD cap multiplies current supply, quote per token and quote USD once',()=>{
 assert.equal(marketCapUsd('1000000000000000000000000000','0.0000000001884','2500'),'471');
 assert.equal(marketCapUsd('500000000000000000000000000','0.0000000001884','2500'),'235.5');
 assert.equal(marketCapUsd('0','0.2','2500'),'0');
 assert.equal(marketCapUsd('100',undefined,'2500'),null);
 assert.equal(marketCapUsd('100','0.2',undefined),null);
});
test('v4 spot price handles both currency orders and quote decimals',()=>{
 assert.equal(poolSpotPrice(2n**96n,true,18),'1');
 assert.equal(poolSpotPrice(2n**97n,true,18),'4');
 assert.equal(poolSpotPrice(2n**97n,false,18),'0.25');
 assert.equal(poolSpotPrice(2n**96n,true,6),'1000000000000');
 assert.throws(()=>poolSpotPrice(0n,true,18));
});
