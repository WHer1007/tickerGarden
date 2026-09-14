import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import claim from '../src/pages/rewards.ts';
import staking from '../src/pages/staking.ts';
const stakingCss=readFileSync(new URL('../src/pages/staking.css',import.meta.url),'utf8');

test('claim exposes only Creator and Holder with no staking transactions or hero',()=>{
  const roles=[...claim.html.matchAll(/data-rewards-tab="([^"]+)"/g)].map(m=>m[1]);
  assert.deepEqual(roles,['creator','treasury']);
  assert.match(claim.html,/aria-orientation="vertical"/);
  assert.doesNotMatch(claim.html,/data-reward-action="(?:stake|unstakeAndWithdraw|rageQuit|claimStaker)"/);
  assert.doesNotMatch(claim.html,/<h1|reward-hero/);
  for(const action of ['claimCreator','claim','claimContinuous'])assert.ok(claim.html.includes(`data-reward-action="${action}"`));
  for(const action of ['claimCreatorRaw','requestCreatorRawRecovery','requestStakerRawExit','cancelStakerRawExit'])assert.doesNotMatch(claim.html+staking.html,new RegExp(`data-reward-action="${action}"`));
  assert.doesNotMatch(claim.html,/data-creator-action-help|Network fee applies|Trading fees earned|Claim Quote, Meme|Includes base fees/);
  assert.doesNotMatch(claim.html,/Connect your wallet and select a token/);
  assert.doesNotMatch(claim.html,/>[^<]*Meme[^<]*</i);
  assert.match(claim.html,/Token rewards/);
});
test('separate staking surface retains position exits and staking rewards',()=>{
  for(const action of ['stake','unstakeAndWithdraw','claimStaker'])assert.ok(staking.html.includes(`data-reward-action="${action}"`));
  for(const action of ['rageQuit','directVaultRageQuit','requestStakerRawExit','cancelStakerRawExit'])assert.doesNotMatch(staking.html,new RegExp(`data-reward-action="${action}"`));
  assert.doesNotMatch(staking.html,/data-rewards-tab="(?:creator|treasury)"/);
  assert.doesNotMatch(staking.html,/data-staker-action-help|data-unstake-preview/);
  const positionStats=staking.html.slice(staking.html.indexOf('class="position-stats"'),staking.html.indexOf('class="rewards-card"'));
  assert.doesNotMatch(positionStats,/data-stake-active-breakdown|Active \+ pending stake/);
  assert.ok(positionStats.indexOf('Staked principal')<positionStats.indexOf('Withdrawal status'));
  assert.ok(positionStats.indexOf('Withdrawal status')<positionStats.indexOf('Wallet available'));
  const heading=staking.html.slice(staking.html.indexOf('class="section-heading"'),staking.html.indexOf('class="position-stats"'));
  assert.match(heading,/data-open-stake[\s\S]*data-reward-action="unstakeAndWithdraw"/);
  assert.match(heading,/data-reward-action="unstakeAndWithdraw"[^>]*>[\s\S]*ph-minus-circle/);
  assert.doesNotMatch(heading,/ph-arrow-counter-clockwise/);
  assert.doesNotMatch(staking.html.slice(staking.html.indexOf('class="reward-actions"')),/data-reward-action="unstakeAndWithdraw"/);
});

test('staking keeps a single modal submission and reachable position actions',()=>{
  assert.equal([...staking.html.matchAll(/data-reward-action="stake"/g)].length,1);
  assert.equal([...staking.html.matchAll(/id="stake-amount"/g)].length,1);
  const dialog=staking.html.slice(staking.html.indexOf('<dialog'));
  assert.match(dialog,/data-reward-form="stake"/);
  assert.match(dialog,/aria-describedby="stake-preview" required/);
  assert.doesNotMatch(dialog,/method="dialog"/);
  assert.match(staking.html,/data-reward-asset="quote"/);
  assert.deepEqual([...staking.html.matchAll(/data-rewards-tab="([^"]+)"/g)].map(m=>m[1]),['positions']);
  assert.ok(staking.html.indexOf('data-stake-history-more')>staking.html.indexOf('</div>',staking.html.indexOf('data-stake-my-markets')));
});

test('staking provides a dedicated full-page state for an empty portfolio',()=>{
  assert.match(staking.html,/data-stake-portfolio-empty[^>]*hidden/);
  assert.match(staking.html,/No active stakes yet/);
  assert.doesNotMatch(staking.html,/data-stake-unlock-at/);
  assert.match(stakingCss,/strong\[data-stake-unlock\][^{]*\{[^}]*display:flex[^}]*flex-wrap:nowrap[^}]*font-size:10px[^}]*color:#92998d[^}]*white-space:nowrap/);
  assert.doesNotMatch(stakingCss,/data-stake-unlock\]\[data-state/);
  const readyStyle=stakingCss.match(/\.staking-page \.stake-unlock-ready\{([^}]*)\}/)?.[1]??'';
  assert.match(readyStyle,/color:#3f6d45/);
  assert.doesNotMatch(readyStyle,/border|background|box-shadow|border-radius/);
  assert.match(stakingCss,/\[data-stake-unlock\] \[data-stake-countdown\][^{]*\{[^}]*font-size:20px[^}]*color:var\(--ink\)/);
  assert.match(stakingCss,/stake-unlock-caption,.stake-unlock-suffix[^}]*font-size:10px[^}]*color:#92998d/);
  assert.match(stakingCss,/strong\[data-stake-total\][^{]*strong\[data-stake-wallet\][^{]*strong\[data-stake-allocated\][^{]*\{[^}]*display:flex[^}]*column-gap:12px/);
  assert.match(staking.html,/data-stake-empty-action/);
  assert.match(staking.html,/Choose a market[\s\S]*Stake Stock[\s\S]*Earn fees/);
});
