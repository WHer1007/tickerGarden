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

test('holder snapshots use the documented error schema and private cache policy',async()=>{
 const pool={connect:async()=>({query:async()=>({rows:[],rowCount:0}),release(){}})} as unknown as Pool;
 const app=createReadApiApp({env:{NODE_ENV:'test',TG_READ_DATABASE_URL:'postgres://unused',TG_CURSOR_SECRET:'x'.repeat(32)},pool});
 const malformed=await app.request('/v1/holder-snapshots?chainId=1');assert.equal(malformed.status,400);assert.equal((await malformed.json()).error,'invalid_query');
 const response=await app.request(`/v1/holder-snapshots?chainId=46630&distributor=0x${'1'.repeat(40)}&marketId=0x${'2'.repeat(64)}&account=0x${'3'.repeat(40)}`);
 assert.equal(response.status,503);assert.equal(response.headers.get('cache-control'),'no-store');
 const body=await response.json();assert.equal(body.error,'snapshot_unavailable');assert.equal(typeof body.requestId,'string');
 const method=await app.request('/v1/holder-snapshots',{method:'POST'});assert.equal(method.status,405);assert.equal((await method.json()).error,'method_not_allowed');
});
