import assert from 'node:assert/strict';
import test from 'node:test';
import {reconcileVisibleCards,resolveExploreImageURI} from '../src/v1/exploreUpdates.ts';

test('card reconciliation updates reorged rows, removes missing requested rows, and preserves unrelated cards',()=>{
 const previous={a:{version:1},b:{version:2},c:{version:3}};
 const result=reconcileVisibleCards({visibleIdsAtRequest:['a','b','c'],visibleIdsNow:['a','b','c'],generationAtRequest:'4:7',generationNow:'4:7',requestedIds:['a','b'],returned:[{marketId:'a',version:9}],previous,full:false,toStat:item=>({version:item.version})});
 assert.deepEqual(result,{stats:{a:{version:9},c:{version:3}},missing:['b']});
});

test('card reconciliation rejects a response from an older visible-page generation',()=>{
 const result=reconcileVisibleCards({visibleIdsAtRequest:['a'],visibleIdsNow:['a'],generationAtRequest:'1:2',generationNow:'1:3',requestedIds:['a'],returned:[{marketId:'a'}],previous:{},full:true,toStat:()=>({ok:true})});
 assert.equal(result,null);
});

test('card reconciliation rejects a response after visible IDs change',()=>{
 const result=reconcileVisibleCards({visibleIdsAtRequest:['a'],visibleIdsNow:['b'],generationAtRequest:'1:2',generationNow:'1:2',requestedIds:['a'],returned:[{marketId:'a'}],previous:{},full:true,toStat:()=>({ok:true})});
 assert.equal(result,null);
});

test('Explore image URLs accept safe HTTPS and configured IPFS paths only',()=>{
 const cid=`b${'a'.repeat(58)}`;
 assert.equal(resolveExploreImageURI(`ipfs://${cid}/logo.webp`,'https://ipfs.example/'),`https://ipfs.example/ipfs/${cid}/logo.webp`);
 assert.equal(resolveExploreImageURI('https://cdn.example/logo.webp'),'https://cdn.example/logo.webp');
 assert.equal(resolveExploreImageURI('ipfs://bad/logo.webp','https://ipfs.example/'),null);
 assert.equal(resolveExploreImageURI('https://user:pass@cdn.example/logo.webp'),null);
});
