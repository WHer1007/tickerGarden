import assert from 'node:assert/strict';
import test from 'node:test';
import { createServiceApp, readServiceConfig } from '../../packages/http/src/index.ts';
import {rpcBudgetEndpoint} from '../../apps/read-api/src/rpc-budget.ts';

test('private RPC budget POST reaches authentication without opening other read API mutations',async()=>{
 const path='/v1/internal/rpc-budget';
 const app=createServiceApp({kind:'read-api',env:{NODE_ENV:'test'},readApiPostPaths:[path]});
 const handler=rpcBudgetEndpoint(()=>{throw Error('unauthorized request must not access database');},{});
 app.post(path,c=>handler(c.req.raw));
 assert.equal((await app.request(path,{method:'POST',body:'{}'})).status,403);
 for(const other of ['/v1/markets',path+'/other',path+'/'])assert.equal((await app.request(other,{method:'POST'})).status,405);
 for(const method of ['PUT','PATCH','DELETE'])assert.equal((await app.request(path,{method})).status,405);
});

test('liveness and readiness are separate', async () => {
  const app = createServiceApp({ kind: 'read-api', env: { NODE_ENV: 'test' }, requiredEnvironmentKeys: ['TG_READ_DATABASE_URL'] });
  const live = await app.request('/internal/live');
  assert.equal(live.status, 200);
  assert.equal((await live.json()).status, 'live');
  const ready = await app.request('/internal/ready');
  assert.equal(ready.status, 503);
  assert.deepEqual((await ready.json()).reasons, ['TG_READ_DATABASE_URL is missing']);
});

test('CORS reflects only an exact configured origin', async () => {
  const app = createServiceApp({ kind: 'content', env: { NODE_ENV: 'test', TG_ALLOWED_ORIGINS: 'https://app.tickergarden.example' } });
  const allowed = await app.request('/internal/live', { headers: { origin: 'https://app.tickergarden.example' } });
  assert.equal(allowed.headers.get('access-control-allow-origin'), 'https://app.tickergarden.example');
  const denied = await app.request('/internal/live', { headers: { origin: 'https://attacker.example' } });
  assert.equal(denied.headers.get('access-control-allow-origin'), null);
});

test('preflight rejects an origin outside the allowlist', async () => {
  const app = createServiceApp({ kind: 'content', env: { NODE_ENV: 'test', TG_ALLOWED_ORIGINS: 'https://app.tickergarden.example' } });
  const response = await app.request('/internal/live', { method: 'OPTIONS', headers: { origin: 'https://attacker.example' } });
  assert.equal(response.status, 403);
  assert.equal((await response.json()).error, 'origin_not_allowed');
});

test('production public services fail readiness without an origin allowlist', () => {
  const config = readServiceConfig({ kind: 'read-api', env: { VERCEL_ENV: 'production', TG_READ_DATABASE_URL: 'postgres://configured' } });
  assert.equal(config.ready, false);
  assert.deepEqual(config.readinessReasons, ['TG_ALLOWED_ORIGINS is missing']);
});

test('read-api rejects mutation methods with an explicit allow header', async () => {
  const app = createServiceApp({ kind: 'read-api', env: { NODE_ENV: 'test' } });
  const response = await app.request('/internal/live', { method: 'POST' });
  assert.equal(response.status, 405);
  assert.equal(response.headers.get('allow'), 'GET, HEAD, OPTIONS');
  assert.equal((await response.json()).error, 'method_not_allowed');
});

test('request body budget is enforced before handlers run', async () => {
  const app = createServiceApp({ kind: 'content', env: { NODE_ENV: 'test' }, maxBodyBytes: 8 });
  const response = await app.request('/missing', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'content-length': '18' },
    body: '{"too":"large"}',
  });
  assert.equal(response.status, 413);
  assert.equal((await response.json()).error, 'request_too_large');
});

test('request IDs are preserved only when they use the accepted syntax', async () => {
  const app = createServiceApp({ kind: 'read-api', env: { NODE_ENV: 'test' } });
  const accepted = await app.request('/internal/live', { headers: { 'x-request-id': 'request-123' } });
  assert.equal(accepted.headers.get('x-request-id'), 'request-123');
  const replaced = await app.request('/internal/live', { headers: { 'x-request-id': 'bad request id' } });
  assert.match(replaced.headers.get('x-request-id') ?? '', /^[0-9a-f-]{36}$/);
});


test('origin-less and rejected-origin GETs cannot poison a public response cache', async () => {
  const app = createServiceApp({kind:'read-api',env:{NODE_ENV:'test',TG_ALLOWED_ORIGINS:'https://app.tickergarden.example'}});
  app.get('/cached',c=>{c.header('cache-control','public, max-age=60, s-maxage=300');return c.json({ok:true});});
  for(const origin of [undefined,'https://attacker.example']){
    const r=await app.request('/cached',{headers:origin?{origin}:{}});
    assert.equal(r.headers.get('cache-control'),'no-store');
    assert.equal(r.headers.get('vary'),'Origin');
    assert.equal(r.headers.get('access-control-allow-origin'),null);
  }
  const r=await app.request('/cached',{headers:{origin:'https://app.tickergarden.example'}});
  assert.equal(r.headers.get('access-control-allow-origin'),'https://app.tickergarden.example');
  assert.equal(r.headers.get('vary'),'Origin');
  assert.match(r.headers.get('cache-control')??'',/s-maxage=300/);
});
