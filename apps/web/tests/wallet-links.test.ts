import assert from 'node:assert/strict';
import { test } from 'node:test';
import { metamaskDappLink } from '../src/ui/wallet-links.ts';

test('metamask dapp links preserve HTTPS path, query, and hash', () => {
  assert.equal(
    metamaskDappLink('https://tickergarden.com/trade?marketId=abc#details'),
    'https://metamask.app.link/dapp/tickergarden.com/trade?marketId=abc#details',
  );
});

test('metamask dapp links reject insecure or credential-bearing URLs', () => {
  assert.equal(metamaskDappLink('http://tickergarden.com/trade'), null);
  assert.equal(metamaskDappLink('https://user:pass@tickergarden.com/trade'), null);
});
