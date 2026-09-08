import assert from 'node:assert/strict';
import test from 'node:test';
import claim from '../src/pages/rewards.ts';
import staking from '../src/pages/staking.ts';

test('claim exposes only Creator and Holder with no staking transactions or hero',()=>{
  const roles=[...claim.html.matchAll(/data-rewards-tab="([^"]+)"/g)].map(m=>m[1]);
  assert.deepEqual(roles,['creator','treasury']);
  assert.match(claim.html,/aria-orientation="vertical"/);
  assert.doesNotMatch(claim.html,/data-reward-action="(?:stake|unstakeAndWithdraw|rageQuit|claimStaker)"/);
  assert.doesNotMatch(claim.html,/<h1|reward-hero/);
  for(const action of ['claimCreator','claimCreatorRaw','claim','claimContinuous'])assert.ok(claim.html.includes(`data-reward-action="${action}"`));
});
test('separate staking surface retains position exits and staking rewards',()=>{
  for(const action of ['stake','unstakeAndWithdraw','rageQuit','directVaultRageQuit','claimStaker'])assert.ok(staking.html.includes(`data-reward-action="${action}"`));
  assert.doesNotMatch(staking.html,/data-rewards-tab="(?:creator|treasury)"/);
});
