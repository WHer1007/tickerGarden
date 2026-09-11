import assert from 'node:assert/strict';
import {test} from 'node:test';
import explore from '../src/pages/markets.ts';
test('Explore separates life stages and exposes only token search plus Stock filter',()=>{
 assert.match(explore.html,/data-stage-grid="1"/);assert.match(explore.html,/data-stage-grid="0"/);
 assert.match(explore.html,/explore-stage-bloomed/);assert.match(explore.html,/explore-stage-growing/);
 assert.match(explore.html,/data-market-search/);assert.match(explore.html,/data-market-asset/);
 assert.doesNotMatch(explore.html,/data-market-sort|data-market-stock-search|data-market-filter/);
 assert.match(explore.html,/explore-card-image/);assert.match(explore.html,/data-market-tone/);
 assert.match(explore.html,/data-market-address/);
});
