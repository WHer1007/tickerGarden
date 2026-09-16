import assert from 'node:assert/strict';
import test from 'node:test';
import { decodeCursor, encodeCursor, PublicationChangedError } from '../../packages/read-store/src/index.ts';

test('pagination cursor is signed and bound to scope, revision and filters', () => {
  const secret = 'cursor-secret-that-is-longer-than-32-bytes';
  const value = { scope: 'markets', revision: `1:0x${'a'.repeat(64)}`, filterDigest: 'filter-a', sortKey: '001', identity: 'market-a' };
  const cursor = encodeCursor(value, secret);
  assert.deepEqual(decodeCursor(cursor, { scope: value.scope, revision: value.revision, filterDigest: value.filterDigest }, secret), { v: 1, ...value });
  assert.throws(() => decodeCursor(`${cursor.slice(0, -1)}x`, { scope: value.scope, revision: value.revision, filterDigest: value.filterDigest }, secret), PublicationChangedError);
  assert.throws(() => decodeCursor(cursor, { scope: 'configs', revision: value.revision, filterDigest: value.filterDigest }, secret), PublicationChangedError);
});
