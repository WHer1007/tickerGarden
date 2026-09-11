import test from 'node:test';
import assert from 'node:assert/strict';
import {stakeProgress,stakeLockLabel} from '../src/ui/stake-progress.ts';
test('staking progress distinguishes approval, wallet signing, mining and balance updates',()=>{
 assert.equal(stakeProgress('awaiting_approval_signature').label,'Approve in wallet…');
 assert.equal(stakeProgress('approval_submitted').label,'Approving…');
 assert.equal(stakeProgress('approval_confirmed').label,'Preparing stake…');
 assert.equal(stakeProgress('awaiting_signature').label,'Confirm in wallet…');
 for(const stage of ['submitted','pending','replaced','confirming'] as const)assert.equal(stakeProgress(stage).label,'Confirming stake…');
 assert.equal(stakeProgress('confirmed').label,'Updating balances…');
 assert.match(stakeProgress('unknown').message,/before trying again/);
});
test('stake status uses second-resolution durations and unlock boundaries',()=>{
 assert.equal(stakeLockLabel(0n,100n,1000n),'No active stake');
 assert.equal(stakeLockLabel(1n,100n,100n),'Available to withdraw');
 assert.equal(stakeLockLabel(1n,100n,99n),'Available to withdraw');
 assert.equal(stakeLockLabel(1n,100n,160n),'Unlocks in 00:01:00');
 assert.equal(stakeLockLabel(1n,101n,160n),'Unlocks in 00:00:59');
 assert.equal(stakeLockLabel(1n,100n,101n),'Unlocks in 00:00:01');
 assert.equal(stakeLockLabel(1n,100n,3760n),'Unlocks in 01:01:00');
 assert.equal(stakeLockLabel(1n,100n,86500n),'Unlocks in 24:00:00');
});
