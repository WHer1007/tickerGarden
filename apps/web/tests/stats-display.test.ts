import assert from 'node:assert/strict';
import {test} from 'node:test';
import {parseStatsDisplay,StatsDisplayStore} from '../src/v1/statsDisplay.ts';

const overview=(volumeUsd:string|null,revision='r1')=>({schemaVersion:4,chainId:4663,displayOnly:true,revision,sections:{overview:{volumeUsd,feeRevenueUsd:'2.75',launches24h:3,bloomedMarkets:5,stakingValueUsd:null,stakingWallets:0}}});
test('Stats display validates materialized USD and confirmed sections',()=>{
 assert.equal(parseStatsDisplay(overview('0'),4663).sections.overview?.volumeUsd,'0');
 for(const patch of [{chainId:1},{schemaVersion:3},{displayOnly:false},{sections:{overview:{...overview('1').sections.overview,volumeUsd:'NaN'}}},{sections:{overview:{...overview('1').sections.overview,bloomedMarkets:-1}}}])assert.throws(()=>parseStatsDisplay({...overview('1'),...patch},4663));
});
test('scoped updates replace only their section and omitted sections keep their last values',()=>{
 const store=new StatsDisplayStore(4663);
 store.apply(overview('12.5'));
 store.apply({schemaVersion:4,chainId:4663,displayOnly:true,revision:'r2',sections:{allocations:{creator:'1',staker:'2',holder:null,platform:'0'}}},'allocations');
 assert.equal(store.snapshot.sections.overview?.volumeUsd,'12.5');
 assert.equal(store.snapshot.sections.allocations?.staker,'2');
 assert.equal(store.snapshot.revision,'r2');
});
test('invalid or failed updates cannot mutate the retained display state',()=>{
 const store=new StatsDisplayStore(4663);store.apply(overview('7'));
 assert.throws(()=>store.apply(overview('Infinity')));
 assert.throws(()=>store.apply(overview('5'),'stocks'),/Missing requested/);
 assert.equal(store.snapshot.sections.overview?.volumeUsd,'7');
});
