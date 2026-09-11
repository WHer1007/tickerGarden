import assert from 'node:assert/strict';
import test from 'node:test';
import { address, chainId, hash32, isoTimestamp, migrationSql, permissionsSql, uint256 } from '../../packages/db/src/index.ts';

test('database codecs preserve canonical chain values without Number conversion', () => {
  assert.equal(address(`0x${'a'.repeat(40)}`), `0x${'a'.repeat(40)}`);
  assert.throws(() => address(`0x${'A'.repeat(40)}`), /lowercase/);
  assert.equal(hash32(`0x${'b'.repeat(64)}`), `0x${'b'.repeat(64)}`);
  assert.throws(() => hash32('0x12'), /32-byte/);
  assert.equal(uint256((1n << 256n) - 1n), ((1n << 256n) - 1n).toString());
  assert.throws(() => uint256(1n << 256n), /exceeds/);
  assert.throws(() => uint256('01'), /canonical/);
  assert.equal(chainId(46630), 46630);
  assert.throws(() => chainId(1), /unsupported/);
  assert.equal(isoTimestamp('2026-09-10T10:20:30.123456Z'), '2026-09-10T10:20:30.123456Z');
  assert.throws(() => isoTimestamp('2026-09-10T10:20:30+08:00'), /UTC/);
});

test('migration and grants accept only bounded PostgreSQL identifiers', () => {
  assert.match(migrationSql('tg_test_1'), /CREATE SCHEMA IF NOT EXISTS tg_test_1/);
  assert.throws(() => migrationSql('public; DROP SCHEMA public'), /invalid/);
  const grants = permissionsSql('tg_test_1', {
    readApi: 'tg_read',
    content: 'tg_content',
    pipeline: 'tg_pipeline',
  });
  assert.match(grants, /GRANT SELECT ON[\s\S]+TO "tg_read"/);
  assert.match(grants, /projection_checkpoints,[\s\S]+TO "tg_read"/);
  assert.match(grants, /GRANT SELECT, INSERT ON "tg_test_1"\.publications TO "tg_pipeline"/);
  assert.doesNotMatch(grants, /UPDATE[^;]+publications/);
  assert.throws(() => permissionsSql('tg_test_1', { readApi: 'bad-role', content: 'tg_content', pipeline: 'tg_pipeline' }), /invalid/);
});
