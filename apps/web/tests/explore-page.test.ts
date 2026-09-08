import assert from 'node:assert/strict';
import {test} from 'node:test';
import explore from '../src/pages/markets.ts';

test('Explore exposes two stage tabs and scoped search controls',()=>{
 assert.match(explore.html,/role="tab"[^>]+data-market-filter="bloomed">Bloomed/);
 assert.match(explore.html,/role="tab"[^>]+data-market-filter="growing">Growing/);
 assert.doesNotMatch(explore.html,/All phases|Curve phase|Pool phase/);
 assert.match(explore.html,/placeholder="Search name or Meme Token address"/);
 assert.match(explore.html,/data-market-stock-search/);
 assert.match(explore.html,/24h volume \(USD\)/);
 assert.match(explore.html,/Market cap \(USD\)/);
});
