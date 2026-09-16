import test from 'node:test';
import assert from 'node:assert/strict';
import {filterMarkets,previewQuote,validateStep,esc} from '../src/model.js';
test('ecosystem, lifecycle and query filters compose',()=>{assert.deepEqual(filterMarkets({base:'NVDA',phase:'bloom',query:'cat'}).map(m=>m.id),['nvcat']);assert.equal(filterMarkets({base:'TSLA',phase:'bloom'}).length,0);});
test('favorites preserve ID selection; sorting is independent',()=>{assert.deepEqual(filterMarkets({phase:'favorites',favorites:['moss','core'],sort:'change'}).map(m=>m.id),['moss','core']);});
test('quote validation fails for invalid amounts and slippage',()=>{for(const n of [0,-1,NaN,Infinity,1000001])assert.equal(previewQuote(n,1,'buy',.5),null);assert.equal(previewQuote(1,1,'buy',6),null);});
test('buy and sell outputs retain units and minimum constraint',()=>{const q=previewQuote(.05,.0000428,'buy',1);assert.ok(q.output>q.minimum);assert.equal(previewQuote(2400,1,'sell',0).output,.99);});
test('wizard prevents missing identity and invalid beneficiaries',()=>{assert.equal(validateStep(1,{name:'a',ticker:'<x',description:'b'}),false);assert.equal(validateStep(1,{name:'a',ticker:'CAT',description:'b'}),true);assert.equal(validateStep(2,{base:'NVDA',quote:'USDG'}),false);assert.equal(validateStep(3,{buy:'1',beneficiary:'0x123'}),false);assert.equal(validateStep(3,{buy:'0',beneficiary:''}),true);});
test('preview text escapes markup',()=>{assert.equal(esc('<script>"x"</script>'),'&lt;script&gt;&quot;x&quot;&lt;/script&gt;');});
