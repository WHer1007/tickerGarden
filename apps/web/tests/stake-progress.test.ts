import test from 'node:test';
import assert from 'node:assert/strict';
import {stakeProgress,stakeLockLabel} from '../src/ui/stake-progress.ts';
test('staking progress distinguishes approval, wallet signing, mining and balance updates',()=>{
 assert.equal(stakeProgress('awaiting_approval_signature').label,'Approve In Wallet…');
 assert.equal(stakeProgress('approval_submitted').label,'Approving…');
 assert.equal(stakeProgress('approval_confirmed').label,'Preparing Stake…');
 assert.equal(stakeProgress('awaiting_signature').label,'Confirm In Wallet…');
 for(const stage of ['submitted','pending','replaced','confirming'] as const)assert.equal(stakeProgress(stage).label,'Confirming Stake…');
 assert.equal(stakeProgress('confirmed').label,'Updating Balances…');
 assert.match(stakeProgress('unknown').message,/Before Trying Again/);
});
test('stake status uses second-resolution durations and unlock boundaries',()=>{
 assert.equal(stakeLockLabel(0n,100n,1000n),'No Active Stake');
 assert.equal(stakeLockLabel(1n,100n,100n),'Available To Withdraw');
 assert.equal(stakeLockLabel(1n,100n,99n),'Available To Withdraw');
 assert.equal(stakeLockLabel(1n,100n,160n),'Unlocks In 00:01:00');
 assert.equal(stakeLockLabel(1n,101n,160n),'Unlocks In 00:00:59');
 assert.equal(stakeLockLabel(1n,100n,101n),'Unlocks In 00:00:01');
 assert.equal(stakeLockLabel(1n,100n,3760n),'Unlocks In 01:01:00');
 assert.equal(stakeLockLabel(1n,100n,86500n),'Unlocks In 24:00:00');
});
