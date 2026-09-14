import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';

const app = readFileSync(new URL('../src/app.ts', import.meta.url), 'utf8');
const rewards = readFileSync(new URL('../src/pages/rewards.ts', import.meta.url), 'utf8');
const staking = readFileSync(new URL('../src/pages/staking.ts', import.meta.url), 'utf8');

test('transaction lifecycle notices mount only in the global bottom notice region', () => {
  assert.match(app, /globalNoticeRegion\(\)\.append\(recoveryPanel\)/);
  assert.match(app, /noticeRegion\.append\(panel\)/);
  assert.doesNotMatch(app, /prepend\(panel\)/);
  assert.doesNotMatch(app, /text\('\[data-rewards-action-status\]'/);
  assert.doesNotMatch(app, /text\('\[data-stake-transaction-status\]'/);
});

test('rewards and staking pages do not reserve inline transaction status blocks', () => {
  assert.doesNotMatch(rewards, /data-rewards-action-status/);
  assert.doesNotMatch(staking, /data-rewards-action-status|data-stake-transaction-status/);
});
