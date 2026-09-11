import assert from 'node:assert/strict';
import {test} from 'node:test';
import {sumStatisticsUSD,summarizeMarkets} from '../src/v1/statsSummary.ts';
test('USD sums retain precision and reject incomplete coverage',()=>{
 assert.equal(sumStatisticsUSD(['9007199254740993.01','0.09']),'9007199254740993.1');
 assert.equal(sumStatisticsUSD(['1',null]),null);
 assert.equal(sumStatisticsUSD(['1e3']),null);
 assert.equal(sumStatisticsUSD(['0','0']),'0');
});
test('Missing directory remains unknown while a verified empty directory is zero',()=>{
 assert.equal(summarizeMarkets([],'24h',100000,false).launches,null);
 assert.equal(summarizeMarkets([],'24h',100000,true).launches,0);
 assert.equal(summarizeMarkets([],'24h',100000,true).volume,'0');
});
