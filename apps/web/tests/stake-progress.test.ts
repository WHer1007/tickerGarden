import test from 'node:test';
import assert from 'node:assert/strict';
import {stakeProgress,stakeLockLabel} from '../src/ui/stake-progress.ts';
import fs from 'node:fs';

const app=fs.readFileSync(new URL('../src/app.ts',import.meta.url),'utf8');
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
 assert.equal(stakeLockLabel(0n,100n,1000n),'No stake');
 assert.equal(stakeLockLabel(1n,100n,100n),'Ready to unstake');
 assert.equal(stakeLockLabel(1n,100n,99n),'Ready to unstake');
 assert.equal(stakeLockLabel(1n,100n,160n),'Locked · 00:01:00 remaining');
 assert.equal(stakeLockLabel(1n,101n,160n),'Locked · 00:00:59 remaining');
 assert.equal(stakeLockLabel(1n,100n,101n),'Locked · 00:00:01 remaining');
 assert.equal(stakeLockLabel(1n,100n,3760n),'Locked · 01:01:00 remaining');
 assert.equal(stakeLockLabel(1n,100n,86500n),'Locked · 24:00:00 remaining');
});

test('stake unlock preview uses an explicit English locale',()=>{
 assert.match(app,/Expected unlock:.*toLocaleString\('en-US'/);
 assert.doesNotMatch(app,/Expected Unlock:/);
});

test('unlocked stake renders as a distinct ready status',()=>{
 assert.match(app,/label==='Ready to unstake'/);
 assert.match(app,/stake-unlock-ready/);
 assert.match(app,/removeAttribute\('data-state'\)/);
 assert.doesNotMatch(app.slice(app.indexOf('function renderStakeCountdown'),app.indexOf('let rewardPositionOwner')),/target\.dataset\.state/);
 const ready=app.slice(app.indexOf("if(label==='Ready to unstake')"),app.indexOf('const locked=',app.indexOf("if(label==='Ready to unstake')")));
 assert.doesNotMatch(ready,/ph-check-circle|createElement\('i'\)/);
});
