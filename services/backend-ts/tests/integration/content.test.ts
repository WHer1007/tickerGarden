import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import test from 'node:test';
import { privateKeyToAccount } from 'viem/accounts';
import { completeContentUpload, createContentChallenge, createContentUpload, readContentUpload } from '../../packages/content-core/src/index.ts';
import { applyCoreMigration, createDatabasePool } from '../../packages/db/src/index.ts';
import { publishContentJob } from '../../packages/content-storage/src/index.ts';
import { createContentApp } from '../../apps/content/src/index.ts';

const connectionString = process.env.TG_MIGRATION_DATABASE_URL ?? process.env.TG_DATABASE_URL;
const ident = (value: string): string => { assert.match(value, /^[a-z][a-z0-9_]{0,62}$/); return `"${value}"`; };

test('TS-12 content authorization is digest-bound, one-use and idempotently recoverable', { timeout: 30_000 }, async (context) => {
  if (!connectionString) { context.skip('TG_MIGRATION_DATABASE_URL or TG_DATABASE_URL is required'); return; }
  const schemaName = `tg_ts12_content_${process.pid}_${randomBytes(4).toString('hex')}`; const schema = ident(schemaName);
  const handle = createDatabasePool(connectionString, { max: 2 }); const origin = 'https://web.example';
  const account = privateKeyToAccount(`0x${'1'.repeat(64)}`); const sessionSecret = 'content-session-secret-at-least-thirty-two-bytes';
  const rawBody = JSON.stringify({ name: 'Garden', symbol: 'GDN', description: 'A token', x: '@garden', website: 'https://garden.example', creatorFeesToHolders: true, creatorTaxBps: 25 });
  const digest = createHash('sha256').update(rawBody).digest('hex');
  try {
    await applyCoreMigration(handle.pool, schemaName);
    const challenge = await createContentChallenge({ pool: handle.pool, account: account.address.toLowerCase() as `0x${string}`, digest, origin,
      expectedOrigin: origin, chainId: 46630, schemaName });
    const signature = await account.signMessage({ message: challenge.message });
    const created = await createContentUpload({ pool: handle.pool, rawBody, nonce: challenge.nonce, signature, origin, expectedOrigin: origin,
      chainId: 46630, sessionSecret, schemaName });
    assert.equal(created.status, 'uploaded'); assert.equal(created.image, null);
    const retried = await createContentUpload({ pool: handle.pool, rawBody, nonce: challenge.nonce, signature, origin, expectedOrigin: origin,
      chainId: 46630, sessionSecret, schemaName });
    assert.equal(retried.uploadId, created.uploadId); assert.equal(retried.accessToken, created.accessToken);
    await assert.rejects(createContentUpload({ pool: handle.pool, rawBody: `${rawBody} `, nonce: challenge.nonce, signature, origin, expectedOrigin: origin,
      chainId: 46630, sessionSecret, schemaName }), /ContentAuthorizationError/);
    const completed = await completeContentUpload({ pool: handle.pool, uploadId: created.uploadId, accessToken: created.accessToken, sessionSecret, schemaName });
    assert.equal(completed.status, 'uploaded');
    const status = await readContentUpload({ pool: handle.pool, uploadId: created.uploadId, accessToken: created.accessToken, schemaName });
    assert.equal(status.metadataURI, null); assert.equal(status.status, 'uploaded');
    assert.equal((await handle.pool.query(`SELECT count(*)::int AS count FROM ${schema}.jobs WHERE operation_id=$1`, [`g0:content-${created.uploadId}`])).rows[0]?.count, 1);
    const lease = { id: '1', operationId: `g0:content-${created.uploadId}`, queue: 'content' as const, kind: 'content-publish', payload: { uploadId: created.uploadId },
      payloadDigest: `0x${'2'.repeat(64)}`, generation: '0', fencing: '1', attempt: 1, maxAttempts: 16, leaseExpiresAt: new Date(Date.now() + 60_000) };
    await assert.rejects(publishContentJob({ pool: handle.pool, lease, storage: { bucket: 'unused', region: 'us-east-1', accessKeyId: 'unused', secretAccessKey: 'unused' },
      pinataJwt: 'test-jwt', schemaName, fetch: async () => new Response('provider unavailable', { status: 503 }) }), /IPFS upload rejected/);
    const retryable = await readContentUpload({ pool: handle.pool, uploadId: created.uploadId, accessToken: created.accessToken, schemaName });
    assert.equal(retryable.status, 'uploaded');
    await publishContentJob({ pool: handle.pool, lease, storage: { bucket: 'unused', region: 'us-east-1', accessKeyId: 'unused', secretAccessKey: 'unused' },
      pinataJwt: 'test-jwt', schemaName, fetch: async () => new Response(JSON.stringify({ data: { cid: `Qm${'a'.repeat(44)}` } }), { status: 201, headers: { 'content-type': 'application/json' } }) });
    const ready = await readContentUpload({ pool: handle.pool, uploadId: created.uploadId, accessToken: created.accessToken, schemaName });
    assert.equal(ready.status, 'ready'); assert.equal(ready.metadataURI, `ipfs://Qm${'a'.repeat(44)}`); assert.equal((ready.metadata as { name: string }).name, 'Garden');
    const app = createContentApp({ pool: handle.pool, env: {
      NODE_ENV: 'test', TG_CONTENT_DATABASE_URL: 'configured', TG_DATABASE_SCHEMA: schemaName, TG_CONTENT_BUCKET: 'unused', TG_CONTENT_REGION: 'us-east-1',
      TG_CONTENT_ACCESS_KEY_ID: 'unused', TG_CONTENT_SECRET_ACCESS_KEY: 'unused', TG_CONTENT_SESSION_SECRET: sessionSecret, TG_CONTENT_WEB_ORIGIN: origin,
      PINATA_JWT: 'unused', QSTASH_CURRENT_SIGNING_KEY: 'current', QSTASH_NEXT_SIGNING_KEY: 'next', QSTASH_CONTENT_TOKEN: 'unused',
      TG_CONTENT_JOB_CALLBACK_URL: 'https://content.example/v1/jobs/content', TG_CONTENT_GENERATION: '0', TG_REPAIR_TOKEN: 'repair', CRON_SECRET: 'cron',
    } });
    await handle.pool.query(`UPDATE ${schema}.content_uploads SET status='failed' WHERE upload_id=$1`,[created.uploadId]);
    const invalidCompletion=await app.request(`https://content.example/v1/content/uploads/${created.uploadId}/complete`,{method:'POST',headers:{authorization:`Bearer ${created.accessToken}`,'content-type':'application/json'},body:'{}'});
    assert.equal(invalidCompletion.status,409);
    assert.equal((await invalidCompletion.json() as {error:string}).error,'upload_session_invalid');
    await handle.pool.query(`UPDATE ${schema}.content_uploads SET status='ready' WHERE upload_id=$1`,[created.uploadId]);
    const metricsResponse = await app.request('https://content.example/internal/metrics', { headers: { authorization: 'Bearer repair' } });
    assert.equal(metricsResponse.status, 200);
    const metrics = await metricsResponse.json() as { queue: { queue: string }; content: { failed: number; uploads: Array<{ status: string }> }; database: { total: number } };
    assert.equal(metrics.queue.queue, 'content'); assert.equal(metrics.content.failed, 0);
    assert.ok(metrics.content.uploads.some((item) => item.status === 'ready')); assert.ok(metrics.database.total >= 1);
  } finally { await handle.pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`).catch(() => undefined); await handle.pool.end(); }
});
