import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TickerGardenV1Client } from '../openapi/generated/v1-client.ts';

test('generated client does not bind browser fetch to its client instance', async () => {
  let called = false;
  const browserFetch = function (this: unknown, input: RequestInfo | URL, init?: RequestInit) {
    assert.equal(this, undefined, 'native browser fetch rejects a client receiver');
    assert.equal(String(input), 'http://localhost:8793/health');
    assert.equal(init?.method, 'GET');
    called = true;
    return Promise.resolve(new Response(JSON.stringify({ status: 'read-api' })));
  } as typeof fetch;
  const client = new TickerGardenV1Client('http://localhost:8793', browserFetch);
  await client.getHealth();
  assert.equal(called, true);
});
