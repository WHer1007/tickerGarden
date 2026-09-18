import test from 'node:test';
import assert from 'node:assert/strict';
import { createReadApiApp } from '../../apps/read-api/src/index.ts';
import { TRADE_NATIVE, TRADE_USDG } from '../../packages/chain/src/quote-purchase/zeroex.ts';
import { routes } from '../../packages/chain/src/quote-purchase/routes.ts';

const taker = '0x1111111111111111111111111111111111111111';
const stock = Object.keys(routes)[0]!;
const unsupported = '0x4444444444444444444444444444444444444444';
const base = `sellToken=${TRADE_NATIVE}&buyToken=${TRADE_USDG}&sellAmount=1000&taker=${taker}`;

function fixture() {
  const app = createReadApiApp({
    env: { NODE_ENV: 'test', TG_READ_DATABASE_URL: 'postgres://unused', TG_CURSOR_SECRET: 'x'.repeat(32) },
    deployment: { environment: 'production', chainId: 4663, deploymentDigest: '0x1234', activationBlock: 1n },
  });
  return app;
}

test('conversion endpoint rejects wrong chain and unsupported sell or buy assets without upstream access', async () => {
  const app = fixture();
  for (const query of [
    `chainId=1&${base}`,
    `chainId=4663&sellToken=${stock}&buyToken=${TRADE_USDG}&sellAmount=1000&taker=${taker}`,
    `chainId=4663&sellToken=${TRADE_NATIVE}&buyToken=${unsupported}&sellAmount=1000&taker=${taker}`,
    `chainId=4663&sellToken=${TRADE_NATIVE}&buyToken=${TRADE_NATIVE}&sellAmount=1000&taker=${taker}`,
  ]) {
    const response = await app.request(`/v1/trade-conversion?${query}`);
    assert.equal(response.status, 400);
    assert.equal(response.headers.get('cache-control'), 'no-store');
  }
});

test('conversion endpoint rejects unsupported methods with no-store', async () => {
  const response = await fixture().request('/v1/trade-conversion', { method: 'POST' });
  assert.equal(response.status, 405);
  assert.equal(response.headers.get('cache-control'), 'no-store');
});

test('missing RPC returns sanitized 503 and never calls a third-party quote service', async () => {
  const app = fixture();
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => { calls++; throw new Error('private upstream detail'); }) as typeof fetch;
  try {
    const response = await app.request(`/v1/trade-conversion?chainId=4663&${base}`);
    assert.equal(response.status, 503);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await response.json(), {
      error: 'conversion_unavailable',
      message: 'This payment route is unavailable. Try again or pay with the paired asset.',
    });
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
