import test from 'node:test';import assert from 'node:assert/strict';
import {RewardClaimError,rewardErrorNotice} from '../src/ui/reward-error.ts';
for(const code of ['simulation_failed','wrong_account','unsupported_chain'])test(`${code} explains claim was not submitted`,()=>{
 const n=rewardErrorNotice({code,message:'private calldata=0xabc'});assert.match(n.message,/Claim not submitted/);assert.doesNotMatch(n.message,/history|0xabc|calldata/);
});
for(const code of ['user_rejected',4001,'replacement_cancelled'])test(`${code} is a normal cancellation`,()=>{const n=rewardErrorNotice({cause:{code}});assert.equal(n.message,'Claim cancelled.');assert.equal(n.tone,'info');});
for(const code of ['receipt_timeout','confirmation_failed','pending_transaction'])test(`${code} retains uncertainty without suggesting resubmission`,()=>{const n=rewardErrorNotice({code});assert.match(n.message,/checking automatically/);assert.doesNotMatch(n.message,/not submitted|try again/);});
test('an already submitted claim timeout wins over nested wallet or state errors',()=>{
 assert.match(rewardErrorNotice({code:'confirmation_failed',cause:{code:4001}}).message,/not yet verified/);
});
test('confirmed revert refreshes rewards and never reports pending',()=>{const n=rewardErrorNotice({code:'transaction_reverted'});assert.equal(n.refresh,true);assert.match(n.message,/failed on-chain/);assert.doesNotMatch(n.message,/awaiting|unknown/);});
for(const code of ['no_rewards','already_claimed'])test(`${code} is informational`,()=>{const n=rewardErrorNotice(new RewardClaimError(code,'internal'));assert.equal(n.tone,'info');assert.equal(n.refresh,true);});
for(const [code,match] of [['reward_root_changed',/round has changed/],['reward_proof_invalid',/proof/],['reward_funds_unavailable',/enough funds/]] as const)test(code,()=>{const n=rewardErrorNotice(new RewardClaimError(code,'private root'));assert.match(n.message,match);assert.match(n.message,/not submitted/);assert.doesNotMatch(n.message,/private root/);});
test('staker lock and cleanup reasons survive wrapped simulation failures',()=>{
 assert.match(rewardErrorNotice({code:'simulation_failed',cause:{data:{errorName:'AllocationLocked'}}}).message,/lock ends/);
 assert.match(rewardErrorNotice({code:'simulation_failed',cause:{data:{errorName:'RageQuitSettlementPending'}}}).message,/cleanup/);
});
test('ambiguous wallet send failure never claims nothing was submitted',()=>{assert.doesNotMatch(rewardErrorNotice({code:'submission_failed'}).message,/not submitted|try again/);});
