import assert from 'node:assert/strict';
import test from 'node:test';
import { Receiver } from '@upstash/qstash';
import { signCallback } from '../src/signature.ts';

test('callback signature is accepted by the deployed Vercel receiver', async () => {
  const key = 'test-signing-key-with-at-least-32-bytes';
  const body = JSON.stringify({ operationId: 'op-1', kind: 'chain-worker', payloadDigest: '0x01' });
  const url = 'https://example.com/v1/jobs/chain';
  const signature = signCallback(body, url, key);
  const receiver = new Receiver({ currentSigningKey: key, nextSigningKey: 'next-signing-key-with-at-least-32-bytes' });
  assert.equal(await receiver.verify({ body, signature, url }), true);
});
