import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import test from 'node:test';
import type { Client } from '@upstash/qstash';
import { publishOutbox, retryDelayMs, sha256, verifyQStashRequest, verifyRepairToken, type OutboxLease } from '../../packages/jobs/src/index.ts';
import pipelineApp from '../../apps/pipeline/src/index.ts';

function base64url(value: string | Buffer): string {
  return Buffer.from(value).toString('base64url');
}

function qstashSignature(body: string, url: string, key: string): string {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = base64url(JSON.stringify({
    iss: 'Upstash', sub: url, nbf: now - 5, exp: now + 60,
    body: createHash('sha256').update(body).digest('base64url'),
  }));
  return `${header}.${payload}.${createHmac('sha256', key).update(`${header}.${payload}`).digest('base64url')}`;
}

test('QStash verification binds the raw body and callback URL', async () => {
  const body = '{"operationId":"op-1"}';
  const url = 'https://pipeline.example/v1/jobs/chain';
  const currentSigningKey = 'unit-test-current-signing-key';
  const signature = qstashSignature(body, url, currentSigningKey);
  assert.equal(await verifyQStashRequest({ body, signature, url, currentSigningKey, nextSigningKey: 'next-key' }), true);
  await assert.rejects(
    verifyQStashRequest({ body: `${body} `, signature, url, currentSigningKey, nextSigningKey: 'next-key' }),
    /body hash does not match/,
  );
  await assert.rejects(
    verifyQStashRequest({ body, signature, url: `${url}/other`, currentSigningKey, nextSigningKey: 'next-key' }),
    /invalid subject/,
  );
});

test('outbox publishing uses a fixed destination, deduplication and flow control', async () => {
  const calls: unknown[] = [];
  const client = {
    publishJSON: async (request: unknown) => {
      calls.push(request);
      return { messageId: 'msg_unit' };
    },
  } as unknown as Pick<Client, 'publishJSON'>;
  const lease: OutboxLease = {
    id: '42', operationId: 'operation-42', queue: 'chain', destinationKey: 'chain-worker', payload: { range: '1:10' },
    payloadDigest: sha256('{"range":"1:10"}'), fencing: '1', attempt: 1, maxAttempts: 8, leaseExpiresAt: new Date(Date.now() + 20_000),
  };
  assert.equal(await publishOutbox(client, lease, { 'chain-worker': 'https://pipeline.example/v1/jobs/chain' }), 'msg_unit');
  assert.deepEqual(calls, [{
    url: 'https://pipeline.example/v1/jobs/chain', body: lease.payload,
    deduplicationId: `tg-42-${lease.payloadDigest.slice(2, 18)}`, retries: 3, timeout: '20s',
    flowControl: { key: 'tickergarden-chain', parallelism: 4 },
  }]);
  await assert.rejects(publishOutbox(client, lease, {}), /not registered/);
});

test('retry and repair authentication are bounded', () => {
  assert.equal(retryDelayMs(1), 1_000);
  assert.equal(retryDelayMs(99), 21_600_000);
  assert.equal(verifyRepairToken('repair-secret', 'repair-secret'), true);
  assert.equal(verifyRepairToken('wrong', 'repair-secret'), false);
});

test('repair, dispatch and signature probes fail closed before touching dependencies', async () => {
  for (const path of ['/internal/repair', '/internal/bootstrap', '/internal/dispatch', '/internal/qstash-probe', '/internal/prices/refresh', '/internal/generation/advance']) {
    const response = await pipelineApp.request(path, { method: 'POST', body: '{}' });
    assert.equal(response.status, 401);
    assert.equal((await response.json()).error, 'unauthorized');
  }
});

test('pipeline QStash probe accepts only a valid raw-body signature', async () => {
  const previousCurrent = process.env.QSTASH_CURRENT_SIGNING_KEY;
  const previousNext = process.env.QSTASH_NEXT_SIGNING_KEY;
  const current = 'route-current-signing-key';
  const next = 'route-next-signing-key';
  const url = 'http://local.test/internal/qstash-probe';
  const body = '{"probe":true}';
  process.env.QSTASH_CURRENT_SIGNING_KEY = current;
  process.env.QSTASH_NEXT_SIGNING_KEY = next;
  try {
    const accepted = await pipelineApp.request(url, {
      method: 'POST', body, headers: { 'upstash-signature': qstashSignature(body, url, current) },
    });
    assert.equal(accepted.status, 204);
    const denied = await pipelineApp.request(url, {
      method: 'POST', body: `${body} `, headers: { 'upstash-signature': qstashSignature(body, url, current) },
    });
    assert.equal(denied.status, 401);
  } finally {
    if (previousCurrent === undefined) delete process.env.QSTASH_CURRENT_SIGNING_KEY;
    else process.env.QSTASH_CURRENT_SIGNING_KEY = previousCurrent;
    if (previousNext === undefined) delete process.env.QSTASH_NEXT_SIGNING_KEY;
    else process.env.QSTASH_NEXT_SIGNING_KEY = previousNext;
  }
});
