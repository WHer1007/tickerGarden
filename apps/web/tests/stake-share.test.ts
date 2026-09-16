import test from 'node:test';
import assert from 'node:assert/strict';
import {stakeShare} from '../src/v1/stakingView.ts';
test('stake share handles zero, tiny amounts and exact bigint ratios',()=>{
 assert.equal(stakeShare(0n,0n),'0%');
 assert.equal(stakeShare(1n,4n),'25.00%');
 assert.equal(stakeShare(10n**30n,10n**30n),'100.00%');
 assert.equal(stakeShare(1n,100000n),'<0.01%');
 assert.equal(stakeShare(1n,null),'-');
 assert.equal(stakeShare(2n,1n),'-');
});
