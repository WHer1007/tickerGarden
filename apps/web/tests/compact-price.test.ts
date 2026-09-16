import {test} from 'node:test';import assert from 'node:assert/strict';import {compactPrice} from '../src/ui/compact-price.ts';
test('overview prices remain plain decimals without long insignificant tails',()=>{
 assert.equal(compactPrice('0.000000002081775428151770460'),'0.00000000208178');
 assert.equal(compactPrice('123.456789'),'123.457');
 assert.equal(compactPrice('0.000009999999'),'0.00001');
 assert.equal(compactPrice('100.000000'),'100');assert.equal(compactPrice(undefined),'-');
});
