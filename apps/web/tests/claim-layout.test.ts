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

test('staking keeps a single modal submission and reachable fallback actions',()=>{
  assert.equal([...staking.html.matchAll(/data-reward-action="stake"/g)].length,1);
  assert.equal([...staking.html.matchAll(/id="stake-amount"/g)].length,1);
  const dialog=staking.html.slice(staking.html.indexOf('<dialog'));
  assert.match(dialog,/data-reward-form="stake"/);
  assert.match(dialog,/aria-describedby="stake-preview" required/);
  assert.doesNotMatch(dialog,/method="dialog"/);
  for(const action of ['requestStakerRawExit','cancelStakerRawExit'])assert.ok(staking.html.includes(`data-reward-action="${action}"`));
  assert.match(staking.html,/data-reward-asset="meme"/);
  assert.deepEqual([...staking.html.matchAll(/data-rewards-tab="([^"]+)"/g)].map(m=>m[1]),['positions']);
  assert.ok(staking.html.indexOf('data-stake-history-more')>staking.html.indexOf('</div>',staking.html.indexOf('data-stake-my-markets')));
});
