import {CURRENT_CHAIN_ID,assertRuntimeEnvironment} from '../../../packages/runtime-deployment/src/index.ts';
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import type { Client } from '@upstash/qstash';
import type { Context } from 'hono';
import { createServiceApp } from '../../../packages/http/src/index.ts';
import { createDatabasePool } from '../../../packages/db/src/index.ts';
import { ContentUploadStateError, ContentAuthorizationError, ContentQuotaError, completeContentUpload, createContentChallenge, createContentUpload, readContentUpload } from '../../../packages/content-core/src/index.ts';
import { presignImagePut, publishContentJob, type S3Config } from '../../../packages/content-storage/src/index.ts';
import { advanceQueueGeneration, createQStashClient, dispatchDueOutbox, processSignedJob, readQueueMetrics, repairQueue, StaleQueueGenerationError, verifyRepairToken, type Lease } from '../../../packages/jobs/src/index.ts';

interface ContentAppOptions { readonly env?: Readonly<Record<string, string | undefined>>; readonly pool?: Pool;
  readonly qstashClient?: Pick<Client, 'publishJSON'>; readonly contentProcessor?: (lease: Lease) => Promise<string | Buffer> }

export function createContentApp(options: ContentAppOptions = {}) {
  const env = options.env ?? process.env;
  assertRuntimeEnvironment(env);
  const app = createServiceApp({ kind: 'content', env, maxBodyBytes: 3 * 1024 * 1024, requiredEnvironmentKeys: [
    'TG_CONTENT_DATABASE_URL', 'TG_CONTENT_BUCKET', 'TG_CONTENT_REGION', 'TG_CONTENT_ACCESS_KEY_ID', 'TG_CONTENT_SECRET_ACCESS_KEY',
    'TG_CONTENT_SESSION_SECRET', 'TG_CONTENT_WEB_ORIGIN', 'PINATA_JWT', 'QSTASH_CURRENT_SIGNING_KEY', 'QSTASH_NEXT_SIGNING_KEY',
    'QSTASH_CONTENT_TOKEN', 'TG_CONTENT_JOB_CALLBACK_URL', 'TG_CONTENT_GENERATION', 'TG_REPAIR_TOKEN', 'CRON_SECRET',
  ] });
  let ownedPool: Pool | undefined; const pool = () => ownedPool ??= options.pool ?? createDatabasePool(env.TG_CONTENT_DATABASE_URL ?? '', {}, {role:'content',env}).pool;
  const schemaName = env.TG_DATABASE_SCHEMA; const storage = (): S3Config => ({ bucket: env.TG_CONTENT_BUCKET ?? '', region: env.TG_CONTENT_REGION ?? '',
    accessKeyId: env.TG_CONTENT_ACCESS_KEY_ID ?? '', secretAccessKey: env.TG_CONTENT_SECRET_ACCESS_KEY ?? '',
    ...(env.TG_CONTENT_ENDPOINT ? { endpoint: env.TG_CONTENT_ENDPOINT } : {}), ...(env.TG_CONTENT_SESSION_TOKEN ? { sessionToken: env.TG_CONTENT_SESSION_TOKEN } : {}) });
  const processor = options.contentProcessor ?? ((lease: Lease) => publishContentJob({ pool: pool(), lease, storage: storage(), pinataJwt: env.PINATA_JWT ?? '',
    ...(env.PINATA_GROUP_ID ? { pinataGroupId: env.PINATA_GROUP_ID } : {}), ...(schemaName ? { schemaName } : {}) }));
  const authorized = (header: string | undefined) => { const token = header?.startsWith('Bearer ') ? header.slice(7) : null;
    return verifyRepairToken(token, env.CRON_SECRET ?? '') || verifyRepairToken(token, env.TG_REPAIR_TOKEN ?? ''); };
  const operatorAuthorized = (header: string | undefined) => { const token = header?.startsWith('Bearer ') ? header.slice(7) : null;
    return verifyRepairToken(token, env.TG_REPAIR_TOKEN ?? ''); };

  app.post('/v1/content/challenges', async (context) => {
    try { const body = await context.req.json() as { account?: unknown; digest?: unknown };
      const result = await createContentChallenge({ pool: pool(), account: canonicalAddress(body.account), digest: string(body.digest), origin: requestOrigin(context.req.raw),
        expectedOrigin: env.TG_CONTENT_WEB_ORIGIN ?? '', chainId: CURRENT_CHAIN_ID, ...(schemaName ? { schemaName } : {}) });
      context.header('cache-control', 'no-store'); return context.json(result, 201); } catch (error) { return contentError(context, error); }
  });
  app.post('/v1/content/uploads', async (context) => {
    try { const rawBody = await context.req.text(); const signature = context.req.header('x-upload-signature');
      if (!signature || !/^0x[0-9a-fA-F]{130}$/.test(signature)) throw new ContentAuthorizationError();
      const result = await createContentUpload({ pool: pool(), rawBody, nonce: context.req.header('x-upload-nonce') ?? '', signature: signature as `0x${string}`,
        origin: requestOrigin(context.req.raw), expectedOrigin: env.TG_CONTENT_WEB_ORIGIN ?? '', chainId: CURRENT_CHAIN_ID, sessionSecret: env.TG_CONTENT_SESSION_SECRET ?? '',
        ...(schemaName ? { schemaName } : {}) });
      const upload = result.image ? presignImagePut(storage(), result.image.objectKey, result.image) : null;
      context.header('cache-control', 'no-store'); return context.json({ uploadId: result.uploadId, accessToken: result.accessToken, status: result.status,
        imageUpload: upload ? { url: upload.url, method: 'PUT', headers: upload.headers, digest: result.image!.digest, byteLength: result.image!.byteLength } : null }, 201);
    } catch (error) { return contentError(context, error); }
  });
  app.post('/v1/content/uploads/:uploadId/complete', async (context) => {
    try { const body = await context.req.json().catch(() => ({})) as { objectVersion?: unknown };
      const result = await completeContentUpload({ pool: pool(), uploadId: context.req.param('uploadId'), accessToken: bearer(context.req.header('authorization')),
        ...(typeof body.objectVersion === 'string' ? { objectVersion: body.objectVersion } : {}), sessionSecret: env.TG_CONTENT_SESSION_SECRET ?? '',
        generation: runtimeGeneration(env.TG_CONTENT_GENERATION), ...(schemaName ? { schemaName } : {}) });
      await dispatchOne(pool(), env, options.qstashClient, schemaName); context.header('cache-control', 'no-store');
      return context.json({ uploadId: context.req.param('uploadId'), ...result }, 202); } catch (error) { return contentError(context, error); }
  });
  app.get('/v1/content/uploads/:uploadId', async (context) => {
    try { const result = await readContentUpload({ pool: pool(), uploadId: context.req.param('uploadId'), accessToken: bearer(context.req.header('authorization')),
      ...(schemaName ? { schemaName } : {}) }); context.header('cache-control', 'no-store'); return context.json(result); }
    catch (error) { return contentError(context, error); }
  });
  app.post('/v1/jobs/content', async (context) => {
    const started = performance.now();
    const signature = context.req.header('upstash-signature'), current = env.QSTASH_CURRENT_SIGNING_KEY, next = env.QSTASH_NEXT_SIGNING_KEY;
    if (!signature || !current || !next) return context.json({ error: 'unauthorized', requestId: context.get('requestId') }, 401);
    const body = await context.req.text(); try { const outcome = await processSignedJob({ pool: pool(), queue: 'content', owner: `content-${randomUUID()}`, body, signature,
      url: context.req.url, currentSigningKey: current, nextSigningKey: next, leaseMs: 120_000, process: processor,
      expectedGeneration: runtimeGeneration(env.TG_CONTENT_GENERATION),
      ...(context.req.header('upstash-region') ? { upstashRegion: context.req.header('upstash-region')! } : {}), ...(schemaName ? { schemaName } : {}) });
      emitMetric(env, { event: 'job_execution', queue: 'content', outcome, durationMs: elapsed(started) });
      return context.json({ outcome }, outcome === 'retry' ? 503 : 200); } catch (error) { const stale = error instanceof StaleQueueGenerationError;
      emitMetric(env, { event: 'job_execution', queue: 'content', outcome: stale ? 'stale_generation' : 'unauthorized', durationMs: elapsed(started) });
      return context.json({ error: stale ? 'stale_runtime_generation' : 'unauthorized', requestId: context.get('requestId') }, stale ? 409 : 401); }
  });
  app.post('/internal/repair', async (context) => { if (!authorized(context.req.header('authorization'))) return context.json({ error: 'unauthorized', requestId: context.get('requestId') }, 401);
    return context.json(await repairQueue(pool(), 'content', schemaName, runtimeGeneration(env.TG_CONTENT_GENERATION))); });
  app.post('/internal/generation/advance', async (context) => { if (!operatorAuthorized(context.req.header('authorization'))) return context.json({ error: 'unauthorized', requestId: context.get('requestId') }, 401);
    try { const body = await context.req.json() as { expectedGeneration?: unknown; nextGeneration?: unknown };
      const expected = decimalGeneration(body.expectedGeneration); const next = decimalGeneration(body.nextGeneration);
      if (expected !== runtimeGeneration(env.TG_CONTENT_GENERATION)) throw new Error('runtime generation does not match request');
      await advanceQueueGeneration(pool(), 'content', expected, next, schemaName);
      return context.json({ queue: 'content', previousGeneration: expected.toString(), activeGeneration: next.toString() });
    } catch (error) { return context.json({ error: 'generation_advance_rejected', message: error instanceof Error ? error.message : 'invalid request', requestId: context.get('requestId') }, 409); } });
  app.get('/internal/metrics', async (context) => { if (!authorized(context.req.header('authorization'))) return context.json({ error: 'unauthorized', requestId: context.get('requestId') }, 401);
    context.header('cache-control', 'no-store'); const databasePool = pool(); const [queue, content] = await Promise.all([
      readQueueMetrics(databasePool, 'content', schemaName), readContentMetrics(databasePool, schemaName),
    ]); const database = poolMetrics(databasePool); return context.json({ queue, content, database, alerts: contentAlerts(queue, content, database, env) }); });
  app.on(['GET', 'POST'], '/internal/dispatch', async (context) => { if (!authorized(context.req.header('authorization'))) return context.json({ error: 'unauthorized', requestId: context.get('requestId') }, 401);
    return context.json({ repaired: await repairQueue(pool(), 'content', schemaName, runtimeGeneration(env.TG_CONTENT_GENERATION)), dispatched: await dispatchOne(pool(), env, options.qstashClient, schemaName) }); });
  return app;
}

async function dispatchOne(pool: Pool, env: Readonly<Record<string, string | undefined>>, client: Pick<Client, 'publishJSON'> | undefined, schemaName?: string) {
  const callback = env.TG_CONTENT_JOB_CALLBACK_URL; if (!callback || !env.QSTASH_CONTENT_TOKEN) return 0;
  const result = await dispatchDueOutbox({ pool, queue: 'content', owner: `dispatch-${randomUUID()}`, limit: 1, client: client ?? createQStashClient(env.QSTASH_CONTENT_TOKEN),
    destinations: { 'content-worker': callback }, expectedGeneration: runtimeGeneration(env.TG_CONTENT_GENERATION), ...(schemaName ? { schemaName } : {}) });
  emitMetric(env, { event: 'queue_dispatch', queue: 'content', ...result }); return result;
}
async function readContentMetrics(pool: Pool, schemaName = 'tickergarden_serverless') {
  const schema = identifier(schemaName);
  const rows = await pool.query<{ status: string; count: string; oldest_age_seconds: string }>(
    `SELECT status,count(*)::text count,extract(epoch FROM now()-min(updated_at))::text oldest_age_seconds FROM ${schema}.content_uploads GROUP BY status ORDER BY status`,
  );
  return { uploads: rows.rows.map((row) => ({ status: row.status, count: Number(row.count), oldestAgeSeconds: Math.max(0, Number(row.oldest_age_seconds)) })),
    failed: rows.rows.filter((row) => row.status === 'failed').reduce((sum, row) => sum + Number(row.count), 0) };
}
function poolMetrics(pool: Pool) { return { total: pool.totalCount, idle: pool.idleCount, waiting: pool.waitingCount }; }
function contentAlerts(queue: Awaited<ReturnType<typeof readQueueMetrics>>, content: Awaited<ReturnType<typeof readContentMetrics>>,
  database: ReturnType<typeof poolMetrics>, env: Readonly<Record<string, string | undefined>>) {
  const alerts: Array<{ code: string; severity: 'warning' | 'critical'; value: number; threshold: number }> = [];
  if (queue.oldestOutboxAgeSeconds > 180) alerts.push({ code: 'outbox_age_high', severity: 'critical', value: queue.oldestOutboxAgeSeconds, threshold: 180 });
  const dead = (queue.jobs.dead ?? 0) + (queue.outbox.dead ?? 0);
  if (dead > 0) alerts.push({ code: 'dead_queue_items', severity: 'critical', value: dead, threshold: 0 });
  if (content.failed > 0) alerts.push({ code: 'content_upload_failed', severity: 'critical', value: content.failed, threshold: 0 });
  const poolMax = Number(env.TG_DB_POOL_MAX ?? '4');
  if (database.waiting > 0 || database.total >= Math.ceil(poolMax * 0.8)) alerts.push({ code: 'database_pool_pressure', severity: 'warning', value: database.total, threshold: Math.ceil(poolMax * 0.8) });
  return alerts;
}
function identifier(value: string) { if (!/^[a-z][a-z0-9_]{0,62}$/.test(value)) throw new Error('invalid database schema name'); return `"${value}"`; }
function elapsed(started: number) { return Math.round((performance.now() - started) * 100) / 100; }
function runtimeGeneration(value: string | undefined): bigint {
  if (value === undefined || !/^(0|[1-9][0-9]{0,18})$/.test(value)) throw new Error('TG_CONTENT_GENERATION must be a canonical nonnegative integer');
  return BigInt(value);
}
function decimalGeneration(value: unknown): bigint {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]{0,18})$/.test(value)) throw new Error('generation must be a canonical decimal string');
  return BigInt(value);
}
function emitMetric(env: Readonly<Record<string, string | undefined>>, fields: object) {
  console.info(JSON.stringify({ level: 'info', metric: true, service: 'content', environment: env.TG_ENVIRONMENT ?? 'test', ...fields }));
}
function requestOrigin(request: Request): string { return request.headers.get('origin') ?? '' }
function bearer(value: string | undefined): string { if (!value?.startsWith('Bearer ')) throw new ContentAuthorizationError(); return value.slice(7) }
function string(value: unknown): string { if (typeof value !== 'string') throw new Error('invalid request'); return value }
function canonicalAddress(value: unknown): `0x${string}` { if (typeof value !== 'string' || !/^0x[0-9a-f]{40}$/.test(value)) throw new Error('invalid account'); return value as `0x${string}` }
function contentError(context: Context, error: unknown) { const requestId = context.get('requestId');
  if (error instanceof ContentUploadStateError) return context.json({ error: 'upload_session_invalid', requestId }, 409);
  if (error instanceof ContentAuthorizationError) return context.json({ error: 'invalid_authorization', requestId }, 401);
  if (error instanceof ContentQuotaError) return context.json({ error: 'content_quota_exhausted', requestId }, 429);
  if (error instanceof Error && /invalid/.test(error.message)) return context.json({ error: 'invalid_request', message: error.message, requestId }, 400);
  return context.json({ error: 'content_store_unavailable', requestId }, 503);
}
export default createContentApp();
