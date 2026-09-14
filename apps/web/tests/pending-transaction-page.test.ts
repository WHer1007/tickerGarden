import assert from 'node:assert/strict';
import {test} from 'node:test';
import {pendingTransactionPage} from '../src/v1/pending-transaction-page.ts';

test('scopes pending transaction recovery to its product page', () => {
  assert.equal(pendingTransactionPage('trade:buy:market:1:revision'), 'trade');
  assert.equal(pendingTransactionPage('pool-trade:sell:market:1:123'), 'trade');
  assert.equal(pendingTransactionPage('launch:standard:market:revision'), 'create');
  assert.equal(pendingTransactionPage('reward:stake:market:account:revision'), 'staking');
  assert.equal(pendingTransactionPage('reward:user-claim:market:0:0:account:revision'), 'rewards');
});

test('does not expose legacy or unknown pending records on unrelated pages', () => {
  assert.equal(pendingTransactionPage(undefined), null);
  assert.equal(pendingTransactionPage('transaction-test'), null);
});
