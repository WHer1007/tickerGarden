import {test} from 'node:test';
import assert from 'node:assert/strict';
import {FEATURED_STOCKS,sortStakingAssets} from '../src/create/featured-stocks.ts';
import {readFileSync} from 'node:fs';
test('20 featured official stocks come first without changing membership or source order',()=>{
 const {assets}=JSON.parse(readFileSync(new URL('../src/create/generated/robinhood-mainnet-4663.staking-assets.json',import.meta.url),'utf8'));
 const original=assets.map((a:{symbol:string})=>a.symbol);
 const sorted=sortStakingAssets(assets,(a:{symbol:string})=>a.symbol).map(a=>a.symbol);
 assert.equal(new Set(FEATURED_STOCKS).size,20);
 assert.deepEqual(sorted.slice(0,20),[...FEATURED_STOCKS]);
 assert.deepEqual(sorted.slice(20),sorted.slice(20).sort((a,b)=>a.localeCompare(b,'en')));
 assert.deepEqual([...sorted].sort(),[...original].sort());
 assert.deepEqual(assets.map((a:{symbol:string})=>a.symbol),original);
});
