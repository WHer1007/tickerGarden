import {test} from 'node:test';import assert from 'node:assert/strict';import {compactPrice} from '../src/ui/compact-price.ts';
test('tiny prices abbreviate leading zeros with six significant digits',()=>{
 assert.equal(compactPrice('0.00000000853515'),'0.0₈853515');
 assert.equal(compactPrice('0.000000002081775428151770460'),'0.0₈208178');
 assert.equal(compactPrice('123.456789'),'123.457');
 assert.equal(compactPrice('100.000000'),'100');
});
test('four-zero threshold and rounding across the threshold use the rounded zero count',()=>{
 assert.equal(compactPrice('0.0001234567'),'0.000123457');
 assert.equal(compactPrice('0.00001234567'),'0.0₄123457');
 assert.equal(compactPrice('0.000009999999'),'0.0₄1');
 assert.equal(compactPrice('0.00009999999'),'0.0001');
});
test('multi-digit zero counts and values beyond Number precision remain accurate',()=>{
 assert.equal(compactPrice('0.'+'0'.repeat(10)+'1234567'),'0.0₁₀123457');
 assert.equal(compactPrice('0.'+'0'.repeat(330)+'123456'),'0.0₃₃₀123456');
});
test('zero and unavailable prices are never represented as compact nonzero values',()=>{
 for(const value of ['0','0.0000000000'])assert.equal(compactPrice(value),'0');
 for(const value of [undefined,null,'','NaN','1e-8','-0.1'])assert.equal(compactPrice(value),'-');
});
