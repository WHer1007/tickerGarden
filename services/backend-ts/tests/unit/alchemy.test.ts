import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';
import {
  ALCHEMY_EVM_COMPUTE_UNIT_SCHEDULE, alchemyNominalComputeUnits, parseAlchemyBlockTrigger, parseAlchemyWebhook,
  parseAlchemyWebhookCreationResponse, updateAlchemyRuntimeSecrets, verifyAlchemySignature,
} from '../../packages/alchemy/src/index.ts';

test('Alchemy CU schedule covers every RPC method used by the serverless backend', () => {
  assert.equal(ALCHEMY_EVM_COMPUTE_UNIT_SCHEDULE.asOf, '2026-09-11');
  assert.deepEqual(
    Object.fromEntries(['eth_chainId', 'eth_getBlockByNumber', 'eth_getLogs', 'eth_getTransactionReceipt', 'eth_getTransactionByHash', 'eth_call', 'eth_getCode']
      .map((method) => [method, alchemyNominalComputeUnits(method)])),
    { eth_chainId: 0, eth_getBlockByNumber: 20, eth_getLogs: 60, eth_getTransactionReceipt: 20, eth_getTransactionByHash: 20, eth_call: 26, eth_getCode: 20 },
  );
  assert.equal(alchemyNominalComputeUnits('unsupported_method'), null);
});

test('Alchemy webhook verification uses raw UTF-8 body and constant-time digest comparison', () => {
  const key = 'alchemy-unit-signing-key';
  const body = '{"id":"whevt_unit"}';
  const signature = createHmac('sha256', key).update(body, 'utf8').digest('hex');
  assert.equal(verifyAlchemySignature(body, signature, key), true);
  assert.equal(verifyAlchemySignature(`${body} `, signature, key), false);
  assert.equal(verifyAlchemySignature(body, signature.toUpperCase(), key), false);
  assert.equal(verifyAlchemySignature(body, undefined, key), false);
});

test('Alchemy webhook parser binds webhook identity and supports nanosecond timestamps', () => {
  const body = JSON.stringify({
    webhookId: 'wh_unit123', id: 'whevt_event123', createdAt: '2026-09-10T12:34:56.123456789Z',
    type: 'GRAPHQL', event: { data: { block: { hash: `0x${'1'.repeat(64)}`, number: 123 } }, sequenceNumber: '1001' },
  });
  const webhook = parseAlchemyWebhook(body, 'wh_unit123');
  assert.equal(webhook.id, 'whevt_event123');
  assert.deepEqual(parseAlchemyBlockTrigger(webhook), { number: 123n, hash: `0x${'1'.repeat(64)}` });
  assert.throws(() => parseAlchemyWebhook(body, 'wh_other'), /not trusted/);
  assert.throws(() => parseAlchemyWebhook('{', 'wh_unit123'), /must be JSON/);
});

test('Alchemy management response accepts only an inactive webhook', () => {
  const result = parseAlchemyWebhookCreationResponse({ data: {
    id: 'wh_Test123', version: 'v1', is_active: false, signing_key: 'synthetic-signing-key', network: 'ETH_MAINNET',
  } });
  assert.deepEqual(result, { webhookId: 'wh_Test123', version: 'v1', signingKey: 'synthetic-signing-key', active: false });
  assert.throws(() => parseAlchemyWebhookCreationResponse({ data: {
    id: 'wh_Test123', version: 'v1', is_active: true, signing_key: 'synthetic-signing-key',
  } }), /Invalid input/);
});

test('Alchemy management secrets update one protected environment payload without duplication', () => {
  const created = { webhookId: 'wh_Test123', version: 'v1', signingKey: 'synthetic-signing-key', active: false as const };
  assert.equal(updateAlchemyRuntimeSecrets('ALCHEMY_AUTH_TOKEN="management-only"\nTG_ALCHEMY_WEBHOOK_ID=\'\'\n', created),
    'ALCHEMY_AUTH_TOKEN="management-only"\nTG_ALCHEMY_WEBHOOK_ID="wh_Test123"\nTG_ALCHEMY_WEBHOOK_SIGNING_KEY="synthetic-signing-key"\n');
  assert.throws(() => updateAlchemyRuntimeSecrets('TG_ALCHEMY_WEBHOOK_ID=a\nTG_ALCHEMY_WEBHOOK_ID=b\n', created), /Duplicate TG_ALCHEMY_WEBHOOK_ID/);
});
