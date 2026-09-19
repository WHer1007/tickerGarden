import test from 'node:test';
import assert from 'node:assert/strict';
import {publicError} from '../src/ui/public-error.ts';

const sensitive = 'raw failure https://evil.example/callback calldata=0xdeadbeef economicsHash=0xabc123';

function assertSanitized(value: string) {
  assert.doesNotMatch(value, /raw failure|https?:\/\/|0xdeadbeef|economicsHash|0xabc123/i);
}

test('unknown errors use readable, context-specific fallback messages without echoing details', () => {
  for (const context of ['general', 'recovery', 'preview', 'rewards', 'transaction'] as const) {
    const message = publicError({message: sensitive}, context);
    assert.ok(message.length > 0);
    assertSanitized(message);
  }
});

test('recovery asks the user to check wallet history before another launch', () => {
  const message = publicError(new Error(sensitive), 'recovery');
  assert.match(message, /check .*wallet.*transaction history/i);
  assert.match(message, /before .*another launch|starting another launch/i);
  assertSanitized(message);
});

test('preview and rewards unknown validation errors explain how to retry', () => {
  const preview = publicError(new Error(sensitive), 'preview');
  const rewards = publicError(new Error(sensitive), 'rewards');
  assert.match(preview, /launch details|review|reload|try again/i);
  assert.match(rewards, /rewards|reload|try again|verify/i);
  assertSanitized(preview);
  assertSanitized(rewards);
});

test('unknown transaction errors advise checking wallet history without declaring failure', () => {
  const message = publicError(new Error(sensitive), 'transaction');
  assert.match(message, /check .*wallet.*transaction history/i);
  assert.match(message, /try again|repeat|pending/i);
  assert.doesNotMatch(message, /definitely failed|failed transaction|transaction failed/i);
  assertSanitized(message);
});

test('wallet rejection maps from direct and nested code 4001 errors', () => {
  for (const error of [
    {code: 4001, message: sensitive},
    {code: '4001', message: sensitive},
    {message: sensitive, cause: {code: 4001, message: sensitive}},
  ]) {
    const message = publicError(error, 'transaction');
    assert.match(message, /declined/i);
    assertSanitized(message);
  }
});

test('known transaction failures and cancellation never use unknown-outcome wallet-history advice', () => {
  const cases = [
    [{code: 'transaction_reverted'}, /trade failed on-chain.*refresh the quote and try again/i],
    [{cause: {cause: {code: 'approval_reverted'}}}, /approval failed on-chain.*try again/i],
    [{cause: {code: 'replacement_cancelled'}, code: 'submission_failed'}, /transaction was cancelled.*try again/i],
    [{cause: {cause: {code: 'user_rejected'}}}, /wallet request was declined.*try again/i],
    [{cause: {code: 4001}}, /wallet request was declined.*try again/i],
  ] as const;
  for (const [error, expected] of cases) {
    const message = publicError(error, 'transaction');
    assert.match(message, expected);
    assert.doesNotMatch(message, /check your wallet transaction history|pending transaction|unknown outcome|No trade was completed/i);
  }
});

test('insufficient funds and transaction network timeouts remain actionable and safe', () => {
  const funds = publicError(new Error('insufficient funds for calldata 0xdeadbeef'), 'general');
  assert.match(funds, /balance|amount|network fee/i);
  assertSanitized(funds);

  const timeout = publicError(new Error('network request timed out at https://evil.example'), 'transaction');
  assert.match(timeout, /connection|interrupted|timeout/i);
  assert.match(timeout, /check .*wallet.*transaction history/i);
  assertSanitized(timeout);
});

test('arbitrary thrown strings are sanitized', () => {
  const message = publicError(sensitive, 'general');
  assert.match(message, /temporarily unavailable|reload|try again/i);
  assertSanitized(message);
});
