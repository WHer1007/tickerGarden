import test from 'node:test';
import assert from 'node:assert/strict';
import {estimate,escapeHtml,markets} from '../src/data.js';
test('preview rejects invalid or excessive amounts',()=>{for(const x of [0,-1,NaN,Infinity,1000001])assert.equal(estimate(x,.01,'buy',1),null);});
test('buy preview preserves fee and minimum-output ordering',()=>{const e=estimate(.05,.0000428,'buy',.5);assert.ok(e.output>e.min&&e.min>0);assert.ok(Math.abs(e.min/e.output-.995)<1e-12);});
test('sell preview uses ETH output instead of token output',()=>{assert.equal(estimate(2400,1,'sell',1).output,.99);});
test('user-authored text cannot create HTML in preview',()=>{assert.equal(escapeHtml('<img onerror="x">'), '&lt;img onerror=&quot;x&quot;&gt;');});
test('market IDs are unique; only completed progress is In Bloom',()=>{assert.equal(new Set(markets.map(m=>m.id)).size,markets.length);assert.equal(markets.filter(m=>m.progress===100).length,2);});
