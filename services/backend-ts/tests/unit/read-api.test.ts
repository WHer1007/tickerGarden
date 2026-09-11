import assert from 'node:assert/strict';
import test from 'node:test';
import { createReadApiApp } from '../../apps/read-api/src/index.ts';

test('Read API rejects malformed market queries before opening a database connection', async () => {
  const app = createReadApiApp({ env: {
    NODE_ENV: 'test', TG_READ_DATABASE_URL: 'postgres://unused', TG_CURSOR_SECRET: 'read-api-test-secret-that-is-at-least-32-bytes',
  } });
  const response = await app.request('/v1/markets?limit=0');
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, 'invalid_request');
  const unknown = await app.request('/v1/markets?unexpected=true');
  assert.equal(unknown.status, 400);
  for (const path of [
    `/v1/markets/${'0x' + '1'.repeat(64)}/trades?from=10&to=9`,
    `/v1/markets/${'0x' + '1'.repeat(64)}/candles?interval=2h&from=0&to=3600`,
    `/v1/markets/${'0x' + '1'.repeat(64)}/holders?limit=101`,
  ]) {
    const analytics = await app.request(path);
    assert.equal(analytics.status, 400);
    assert.equal((await analytics.json()).error, 'invalid_query');
  }
});
