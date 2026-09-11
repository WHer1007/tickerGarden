import assert from 'node:assert/strict';
import test from 'node:test';
import { createReadApiApp } from '../../apps/read-api/src/index.ts';
import type { Pool } from 'pg';

test('Read API rejects malformed market queries before opening a database connection', async () => {
  const app = createReadApiApp({ env: {
    NODE_ENV: 'test', TG_READ_DATABASE_URL: 'postgres://unused', TG_CURSOR_SECRET: 'read-api-test-secret-that-is-at-least-32-bytes',
  } });
  const response = await app.request('/v1/markets?limit=0');
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, 'invalid_request');
  const unknown = await app.request('/v1/markets?unexpected=true');
  assert.equal(unknown.status, 400);
  assert.equal(unknown.headers.get('cache-control'), 'no-store');
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

test('display price catalogs use the five-minute shared CDN cache', async () => {
  const pool={query:async()=>({rows:[]})} as unknown as Pool;
  const app=createReadApiApp({env:{NODE_ENV:'test',TG_READ_DATABASE_URL:'postgres://unused',TG_CURSOR_SECRET:'read-api-test-secret-that-is-at-least-32-bytes'},pool});
  for(const path of ['/v1/prices/references','/v1/statistics-prices']){
    const response=await app.request(path);assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'public, max-age=60, s-maxage=300, stale-while-revalidate=60');
  }
});
