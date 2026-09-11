import assert from 'node:assert/strict';
import {test} from 'node:test';
import {statisticsUSD,statisticsFresh} from '../src/v1/statisticsValue.ts';
test('fee and stock values respect 6, 18 and 24 decimal assets',()=>{
 for(const d of [6,18,24])assert.equal(statisticsUSD((3n*10n**BigInt(d)).toString(),d,'2.5',200,100000),'7.5');
 assert.equal(statisticsUSD('1000000000000000000000000',18,'10000',200,100000),'10000000000');
});
test('missing precision, stale prices, malformed amounts never become values',()=>{
 for(const d of [undefined,-1,256,1.5])assert.equal(statisticsUSD('1',d,'2',200,100000),null);
 for(const expiry of [undefined,NaN,100])assert.equal(statisticsUSD('1',18,'2',expiry,100000),null);
 assert.equal(statisticsUSD('0',18,undefined,undefined,100000),'0');
 assert.equal(statisticsUSD('-1',18,'2',200,100000),null);
 assert.equal(statisticsUSD('1',18,'0',200,100000),null);
});
test('snapshots expire at twenty minutes and reject future timestamps',()=>{
 assert.equal(statisticsFresh(1000,2199000),true);
 assert.equal(statisticsFresh(1000,2200000),false);
 assert.equal(statisticsFresh(3000,2200000),false);
});
