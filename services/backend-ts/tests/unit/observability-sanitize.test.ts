import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanText, safeContext, safeError } from '../../packages/observability/src/sanitize.ts';

test('safeError keeps a bounded nested Error cause chain', () => {
  const root = new TypeError('outer failure', {
    cause: new Error('middle failure', { cause: new RangeError('root cause') }),
  });

  const safe = safeError(root);
  assert.equal(safe.type, 'TypeError');
  assert.equal(safe.message, 'outer failure');
  assert.match(String(safe.stack), /TypeError: outer failure/);
  const middle = safe.cause as Record<string, unknown>;
  assert.equal(middle.type, 'Error');
  assert.equal(middle.message, 'middle failure');
  const inner = middle.cause as Record<string, unknown>;
  assert.equal(inner.type, 'RangeError');
  assert.equal(inner.message, 'root cause');

  const tooDeep = new Error('fourth', {
    cause: new Error('third', { cause: new Error('second', { cause: new Error('first') }) }),
  });
  const third = (safeError(tooDeep).cause as Record<string, unknown>).cause as Record<string, unknown>;
  assert.deepEqual(third.cause, { type: 'CauseLimit' });
});

test('cleanText and safeError remove URL credentials, signatures, and tokens from stacks', () => {
  const error = new Error('request failed');
  error.stack = [
    'TypeError: request failed',
    '    at run (/srv/tickergarden/src/worker.ts:31:9)',
    '    at https://user:pass@example.test/path?token=secret-value',
    '    signature=super-secret-signature',
    '    Bearer eyJhbGciOiJIUzI1NiJ9.payload.signature',
  ].join('\n');

  const safe = safeError(error);
  const serialized = JSON.stringify(safe);
  assert.match(serialized, /\/srv\/tickergarden\/src\/worker\.ts:31:9/);
  assert.doesNotMatch(serialized, /user:pass|example\.test|secret-value|super-secret-signature|eyJhbGci/);
  assert.match(serialized, /\[redacted-url\]/);
  assert.match(serialized, /\[redacted-field\]/);
  assert.match(serialized, /\[redacted-auth\]/);
  assert.equal(cleanText('url https://user:pass@example.test/path?token=secret'), 'url [redacted-url]');
});

test('safeContext accepts only allowlisted operational fields', () => {
  const result = safeContext({
    event: 'worker_failed',
    operationId: 'op-123',
    attempt: 2,
    retryable: true,
    unknown: 'must not pass',
    authorization: 'Bearer secret',
    requestBody: { password: 'secret' },
    badNumber: Number.NaN,
    objectValue: { nested: true },
  });

  assert.deepEqual(result, {
    event: 'worker_failed',
    operationId: 'op-123',
    attempt: 2,
    retryable: true,
  });
});

test('cleanText truncates after redaction to the requested bound', () => {
  const output = cleanText(`prefix signature=secret ${'x'.repeat(200)}`, 24);
  assert.equal(output.length, 24);
  assert.ok(output.startsWith('prefix [redacted-field]'));
});

test('safeError does not serialize a non-Error object and preserves useful Error types', () => {
  const object = { message: 'private details', token: 'secret', nested: { data: 'do not serialize' } };
  const nonError = safeError(object);
  assert.deepEqual(nonError, { type: 'NonError', message: 'Non-Error rejection' });
  assert.equal(JSON.stringify(nonError).includes('private details'), false);
  assert.equal(JSON.stringify(nonError).includes('secret'), false);

  class ProviderTimeoutError extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'ProviderTimeoutError';
    }
  }
  const actualError = new ProviderTimeoutError('provider timed out');
  assert.equal(safeError(actualError).type, 'ProviderTimeoutError');
  assert.equal(safeError(actualError).message, 'provider timed out');
});
