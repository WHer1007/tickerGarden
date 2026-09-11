import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import type { Client } from '@upstash/qstash';
import { Hono } from 'hono';
import { createServiceApp } from '../../../packages/http/src/index.ts';
import { createDatabasePool } from '../../../packages/db/src/index.ts';
import {
  advanceQueueGeneration, createQStashClient, dispatchDueOutbox, enqueueReliableMessage, processSignedJob, readQueueMetrics, repairQueue,
  StaleQueueGenerationError, verifyQStashRequest, verifyRepairToken, type Lease,
} from '../../../packages/jobs/src/index.ts';
import { ALCHEMY_EVM_COMPUTE_UNIT_SCHEDULE, alchemyNominalComputeUnits } from '../../../packages/alchemy/src/index.ts';
import { consensusBlock, parseChainLogTrigger, RpcTransport } from '../../../packages/chain/src/index.ts';
import { createChainProcessor } from '../../../packages/chain-worker/src/index.ts';
import { f72PriceTargets, fetchTestnetPriceReferences, storePriceReferences } from '../../../packages/display-price/src/index.ts';
import { CURRENT_ACTIVATION_BLOCK, CURRENT_RELEASE_ID } from '../../../packages/events/src/index.ts';

interface PipelineAppOptions {
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly pool?: Pool;
  readonly qstashClient?: Pick<Client, 'publishJSON'>;
  readonly chainProcessor?: (lease: Lease) => Promise<string | Buffer>;
}

export function createPipelineApp(options: PipelineAppOptions = {}) {
  const env = options.env ?? process.env;
  const app = createServiceApp({
    kind: 'pipeline', env,
    maxBodyBytes: 1024 * 1024,
    requiredEnvironmentKeys: [
      'TG_PIPELINE_DATABASE_URL', 'TG_PIPELINE_GENERATION',
      'QSTASH_CURRENT_SIGNING_KEY', 'QSTASH_NEXT_SIGNING_KEY', 'QSTASH_CHAIN_TOKEN',
      'TG_CHAIN_JOB_CALLBACK_URL', 'TG_RPC_URL', 'TG_SECONDARY_RPC_URL', 'TG_REPAIR_TOKEN', 'TG_PRICE_REFRESH_TOKEN', 'CRON_SECRET',
    ],
  });
  if (!(app instanceof Hono)) throw new Error('pipeline service factory must return a Hono application');

  let ownedPool: Pool | undefined;
  let ownedProcessor: ((lease: Lease) => Promise<string | Buffer>) | undefined;
  function databasePool(): Pool {
    ownedPool ??= options.pool ?? createDatabasePool(env.TG_PIPELINE_DATABASE_URL ?? '').pool;
    return ownedPool;
  }
  function chainProcessor(): (lease: Lease) => Promise<string | Buffer> {
    ownedProcessor ??= options.chainProcessor ?? createChainProcessor({
      pool: databasePool(), primary: new RpcTransport({
        url: env.TG_RPC_URL ?? '', provider: 'alchemy-primary', nominalComputeUnits: alchemyNominalComputeUnits,
        computeUnitSchedule: ALCHEMY_EVM_COMPUTE_UNIT_SCHEDULE.id, observe: (metric) => emitMetric(env, metric),
      }),
      secondary: new RpcTransport({ url: env.TG_SECONDARY_RPC_URL ?? '', provider: 'independent-secondary', observe: (metric) => emitMetric(env, metric) }),
      ...(env.TG_LOGS_SECONDARY_RPC_URL ? { logsSecondary: new RpcTransport({
        url: env.TG_LOGS_SECONDARY_RPC_URL, provider: 'independent-logs-secondary', observe: (metric) => emitMetric(env, metric),
      }) } : {}),
      environment: environmentName(env.TG_ENVIRONMENT),
      ...(env.TG_DATABASE_SCHEMA ? { schemaName: env.TG_DATABASE_SCHEMA } : {}),
      ...(env.V1_FINALITY_DELAY_BLOCKS ? { finalityDelayBlocks: BigInt(env.V1_FINALITY_DELAY_BLOCKS) } : {}),
      ...(env.V1_FINALITY_DELAY_SECONDS ? { finalityDelaySeconds: BigInt(env.V1_FINALITY_DELAY_SECONDS) } : {}),
    });
    return ownedProcessor;
  }

  function authorized(header: string | undefined): boolean {
    const provided = header?.startsWith('Bearer ') ? header.slice(7) : null;
    return verifyRepairToken(provided, env.CRON_SECRET ?? '') || verifyRepairToken(provided, env.TG_REPAIR_TOKEN ?? '');
  }
  function operatorAuthorized(header: string | undefined): boolean {
    const provided = header?.startsWith('Bearer ') ? header.slice(7) : null;
    return verifyRepairToken(provided, env.TG_REPAIR_TOKEN ?? '');
  }
  function priceRefreshAuthorized(header: string | undefined): boolean {
    const provided = header?.startsWith('Bearer ') ? header.slice(7) : null;
    return verifyRepairToken(provided, env.CRON_SECRET ?? '') || verifyRepairToken(provided, env.TG_PRICE_REFRESH_TOKEN ?? '');
  }

  app.post('/internal/repair', async (context) => {
    if (!authorized(context.req.header('authorization'))) return context.json({ error: 'unauthorized', requestId: context.get('requestId') }, 401);
    return context.json(await repairQueue(databasePool(), 'chain', env.TG_DATABASE_SCHEMA, runtimeGeneration(env.TG_PIPELINE_GENERATION)));
  });
  app.post('/internal/bootstrap', async (context) => {
    if (!operatorAuthorized(context.req.header('authorization'))) return context.json({ error: 'unauthorized', requestId: context.get('requestId') }, 401);
    try {
      const primary = new RpcTransport({
        url: env.TG_RPC_URL ?? '', provider: 'alchemy-primary', nominalComputeUnits: alchemyNominalComputeUnits,
        computeUnitSchedule: ALCHEMY_EVM_COMPUTE_UNIT_SCHEDULE.id, observe: (metric) => emitMetric(env, metric),
      });
      const secondary = new RpcTransport({ url: env.TG_SECONDARY_RPC_URL ?? '', provider: 'independent-secondary', observe: (metric) => emitMetric(env, metric) });
      const [primaryHead, secondaryHead] = await Promise.all([primary.latestBlock(), secondary.latestBlock()]);
      const number = primaryHead.number < secondaryHead.number ? primaryHead.number : secondaryHead.number;
      const head = await consensusBlock(primary, secondary, number);
      const generation = runtimeGeneration(env.TG_PIPELINE_GENERATION);
      const suffix = `g${generation}-${head.number}-${head.hash.slice(2, 14)}`;
      const payload = { headBlock: head.number.toString(), headHash: head.hash, fromBlock: 'activation-backfill' } as const;
      const rawBody = JSON.stringify(payload);
      const enqueued = await enqueueReliableMessage(databasePool(), {
        queue: 'chain', externalId: `bootstrap-${suffix}`, operationId: `bootstrap:${suffix}`, kind: 'chain-backfill',
        rawBody, payload, destinationKey: 'chain-worker', maxAttempts: 16, generation,
      }, env.TG_DATABASE_SCHEMA);
      const callback = env.TG_CHAIN_JOB_CALLBACK_URL;
      if (!callback || !env.QSTASH_CHAIN_TOKEN) return context.json({ error: 'not_ready', requestId: context.get('requestId') }, 503);
      const dispatched = await dispatchDueOutbox({
        pool: databasePool(), queue: 'chain', owner: `bootstrap-${randomUUID()}`,
        client: options.qstashClient ?? createQStashClient(env.QSTASH_CHAIN_TOKEN), destinations: { 'chain-worker': callback },
        expectedGeneration: generation,
        ...(env.TG_DATABASE_SCHEMA ? { schemaName: env.TG_DATABASE_SCHEMA } : {}),
      });
      return context.json({ accepted: true, duplicate: enqueued.duplicate, headBlock: head.number.toString(), dispatched });
    } catch (error) {
      return context.json({ error: 'bootstrap_failed', message: error instanceof Error ? error.message : 'bootstrap failed', requestId: context.get('requestId') }, 503);
    }
  });
  app.post('/internal/generation/advance', async (context) => {
    if (!operatorAuthorized(context.req.header('authorization'))) return context.json({ error: 'unauthorized', requestId: context.get('requestId') }, 401);
    try {
      const body = await context.req.json() as { expectedGeneration?: unknown; nextGeneration?: unknown };
      const expected = decimalGeneration(body.expectedGeneration); const next = decimalGeneration(body.nextGeneration);
      if (expected !== runtimeGeneration(env.TG_PIPELINE_GENERATION)) throw new Error('runtime generation does not match request');
      await advanceQueueGeneration(databasePool(), 'chain', expected, next, env.TG_DATABASE_SCHEMA);
      return context.json({ queue: 'chain', previousGeneration: expected.toString(), activeGeneration: next.toString() });
    } catch (error) {
      return context.json({ error: 'generation_advance_rejected', message: error instanceof Error ? error.message : 'invalid request', requestId: context.get('requestId') }, 409);
    }
  });
  app.get('/internal/metrics', async (context) => {
    if (!authorized(context.req.header('authorization'))) return context.json({ error: 'unauthorized', requestId: context.get('requestId') }, 401);
    context.header('cache-control', 'no-store');
    const [queue, pipeline] = await Promise.all([
      readQueueMetrics(databasePool(), 'chain', env.TG_DATABASE_SCHEMA),
      readPipelineMetrics(databasePool(), environmentName(env.TG_ENVIRONMENT), env.TG_DATABASE_SCHEMA),
    ]);
    const database = poolMetrics(databasePool());
    return context.json({ queue, pipeline, database, alerts: pipelineAlerts(queue, pipeline, database, env) });
  });

  app.on(['GET', 'POST'], '/internal/dispatch', async (context) => {
    if (!authorized(context.req.header('authorization'))) return context.json({ error: 'unauthorized', requestId: context.get('requestId') }, 401);
    const callback = env.TG_CHAIN_JOB_CALLBACK_URL;
    if (!callback) return context.json({ error: 'not_ready', requestId: context.get('requestId') }, 503);
    const generation = runtimeGeneration(env.TG_PIPELINE_GENERATION);
    const repaired = await repairQueue(databasePool(), 'chain', env.TG_DATABASE_SCHEMA, generation);
    const dispatched = await dispatchDueOutbox({
      pool: databasePool(), queue: 'chain', owner: `dispatch-${randomUUID()}`,
      client: options.qstashClient ?? createQStashClient(env.QSTASH_CHAIN_TOKEN ?? ''), destinations: { 'chain-worker': callback },
      expectedGeneration: generation,
      ...(env.TG_DATABASE_SCHEMA ? { schemaName: env.TG_DATABASE_SCHEMA } : {}),
    });
    emitMetric(env, { event: 'queue_dispatch', queue: 'chain', ...dispatched });
    return context.json({ repaired, dispatched });
  });

  app.post('/internal/qstash-probe', async (context) => {
    const signature = context.req.header('upstash-signature');
    const currentSigningKey = env.QSTASH_CURRENT_SIGNING_KEY;
    const nextSigningKey = env.QSTASH_NEXT_SIGNING_KEY;
    if (!signature || !currentSigningKey || !nextSigningKey) return context.json({ error: 'unauthorized', requestId: context.get('requestId') }, 401);
    const body = await context.req.text();
    try {
      await verifyQStashRequest({
        body, signature, url: context.req.url, currentSigningKey, nextSigningKey,
        ...(context.req.header('upstash-region') ? { upstashRegion: context.req.header('upstash-region')! } : {}),
      });
    } catch {
      return context.json({ error: 'unauthorized', requestId: context.get('requestId') }, 401);
    }
    return context.body(null, 204);
  });

  app.on(['GET', 'POST'], '/internal/prices/refresh', async (context) => {
    if (!priceRefreshAuthorized(context.req.header('authorization'))) return context.json({ error: 'unauthorized', requestId: context.get('requestId') }, 401);
    const deployment = { environment: environmentName(env.TG_ENVIRONMENT), chainId: 46630 as const,
      deploymentDigest: CURRENT_RELEASE_ID, activationBlock: CURRENT_ACTIVATION_BLOCK };
    const references = await fetchTestnetPriceReferences(f72PriceTargets(), { rpc: new RpcTransport({
      url: env.TG_SECONDARY_RPC_URL ?? '', provider: 'display-price-secondary', observe: (metric) => emitMetric(env, metric),
    }) });
    await storePriceReferences(databasePool(), deployment, references, env.TG_DATABASE_SCHEMA);
    emitMetric(env, { event: 'price_refresh', targets: references.length, available: references.filter((item) => item.status === 'available').length });
    return context.json({ refreshed: references.length, available: references.filter((item) => item.status === 'available').length });
  });

  app.post('/v1/webhooks/chain-relay', async (context) => {
    const rawBody = await context.req.text();
    const signature = context.req.header('upstash-signature');
    const currentSigningKey = env.QSTASH_CURRENT_SIGNING_KEY;
    const nextSigningKey = env.QSTASH_NEXT_SIGNING_KEY;
    if (!signature || !currentSigningKey || !nextSigningKey) return context.json({ error: 'unauthorized', requestId: context.get('requestId') }, 401);
    let payload: Readonly<Record<string, unknown>>;
    let trigger;
    try {
      await verifyQStashRequest({
        body: rawBody, signature, url: context.req.url, currentSigningKey, nextSigningKey,
        ...(context.req.header('upstash-region') ? { upstashRegion: context.req.header('upstash-region')! } : {}),
      });
      payload = JSON.parse(rawBody) as Readonly<Record<string, unknown>>;
      trigger = parseChainLogTrigger(payload, {
        environment: environmentName(env.TG_ENVIRONMENT), chainId: 46630,
        deploymentDigest: CURRENT_RELEASE_ID, activationBlock: CURRENT_ACTIVATION_BLOCK,
      });
    } catch {
      return context.json({ error: 'invalid_chain_relay', requestId: context.get('requestId') }, 401);
    }
    const enqueued = await enqueueReliableMessage(databasePool(), {
      queue: 'chain', externalId: `g${runtimeGeneration(env.TG_PIPELINE_GENERATION)}:ws:${trigger.eventKey}`,
      operationId: `g${runtimeGeneration(env.TG_PIPELINE_GENERATION)}:ws:${trigger.eventKey}`,
      kind: 'chain-log-trigger', rawBody, payload, destinationKey: 'chain-worker', generation: runtimeGeneration(env.TG_PIPELINE_GENERATION),
    }, env.TG_DATABASE_SCHEMA);
    const callback = env.TG_CHAIN_JOB_CALLBACK_URL;
    if (callback && env.QSTASH_CHAIN_TOKEN) {
      await dispatchDueOutbox({
        pool: databasePool(), queue: 'chain', owner: `webhook-${randomUUID()}`, limit: 1,
        client: options.qstashClient ?? createQStashClient(env.QSTASH_CHAIN_TOKEN), destinations: { 'chain-worker': callback },
        expectedGeneration: runtimeGeneration(env.TG_PIPELINE_GENERATION),
        ...(env.TG_DATABASE_SCHEMA ? { schemaName: env.TG_DATABASE_SCHEMA } : {}),
      });
    }
    emitMetric(env, { event: 'chain_relay_delivery', payloadBytes: Buffer.byteLength(rawBody), removed: trigger.removed, duplicate: enqueued.duplicate });
    return context.json({ accepted: true, duplicate: enqueued.duplicate }, 200);
  });

  app.post('/v1/jobs/chain', async (context) => {
    const started = performance.now();
    const signature = context.req.header('upstash-signature');
    const currentSigningKey = env.QSTASH_CURRENT_SIGNING_KEY;
    const nextSigningKey = env.QSTASH_NEXT_SIGNING_KEY;
    if (!signature || !currentSigningKey || !nextSigningKey) return context.json({ error: 'unauthorized', requestId: context.get('requestId') }, 401);
    const body = await context.req.text();
    let outcome;
    try {
      outcome = await processSignedJob({
        pool: databasePool(), queue: 'chain', owner: `worker-${randomUUID()}`, body, signature, url: context.req.url,
        currentSigningKey, nextSigningKey, leaseMs: 290_000, process: chainProcessor(),
        expectedGeneration: runtimeGeneration(env.TG_PIPELINE_GENERATION),
        ...(context.req.header('upstash-region') ? { upstashRegion: context.req.header('upstash-region')! } : {}),
        ...(env.TG_DATABASE_SCHEMA ? { schemaName: env.TG_DATABASE_SCHEMA } : {}),
      });
    } catch (error) {
      const stale = error instanceof StaleQueueGenerationError;
      emitMetric(env, { event: 'job_execution', queue: 'chain', outcome: stale ? 'stale_generation' : 'unauthorized', durationMs: elapsed(started) });
      return context.json({ error: stale ? 'stale_runtime_generation' : 'unauthorized', requestId: context.get('requestId') }, stale ? 409 : 401);
    }
    emitMetric(env, { event: 'job_execution', queue: 'chain', outcome, durationMs: elapsed(started) });
    return context.json({ outcome }, outcome === 'retry' ? 503 : 200);
  });

  return app;
}

async function readPipelineMetrics(pool: Pool, environment: 'preview' | 'test' | 'production', schemaName = 'tickergarden_serverless') {
  const schema = identifier(schemaName);
  const identity = [environment, 46630, CURRENT_RELEASE_ID];
  const [ingestion, projections, conflicts, prices, head] = await Promise.all([
    pool.query<{ stream: string; next_block: string; generation: string; age_seconds: string }>(
      `SELECT stream,next_block::text,generation::text,extract(epoch FROM now()-updated_at)::text age_seconds FROM ${schema}.ingestion_checkpoints WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 ORDER BY stream`, identity),
    pool.query<{ scope: string; next_block: string; generation: string; age_seconds: string }>(
      `SELECT scope,next_block::text,generation::text,extract(epoch FROM now()-updated_at)::text age_seconds FROM ${schema}.projection_checkpoints WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 ORDER BY scope`, identity),
    pool.query<{ count: string }>(`SELECT count(*)::text count FROM ${schema}.source_conflicts WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND resolved_at IS NULL`, identity),
    pool.query<{ status: string; count: string; oldest_age_seconds: string; nearest_expiry_seconds: string }>(
      `SELECT status,count(*)::text count,extract(epoch FROM now()-min(as_of))::text oldest_age_seconds,extract(epoch FROM min(expires_at)-now())::text nearest_expiry_seconds FROM ${schema}.price_references WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 GROUP BY status ORDER BY status`, identity),
    pool.query<{ number: string | null }>(`SELECT max(number)::text number FROM ${schema}.chain_blocks WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND canonical`, identity),
  ]);
  const headNumber = head.rows[0]?.number === null || head.rows[0]?.number === undefined ? null : BigInt(head.rows[0].number);
  return {
    environment, chainId: 46630, deploymentDigest: CURRENT_RELEASE_ID,
    headBlockNumber: headNumber?.toString() ?? null,
    unresolvedSourceConflicts: Number(conflicts.rows[0]?.count ?? 0),
    ingestion: ingestion.rows.map((row) => ({ stream: row.stream, nextBlock: row.next_block, generation: row.generation,
      checkpointAgeSeconds: Math.max(0, Number(row.age_seconds)), lagBlocks: headNumber === null ? null : maxBigInt(0n, headNumber - BigInt(row.next_block) + 1n).toString() })),
    projections: projections.rows.map((row) => ({ scope: row.scope, nextBlock: row.next_block, generation: row.generation,
      checkpointAgeSeconds: Math.max(0, Number(row.age_seconds)), lagBlocks: headNumber === null ? null : maxBigInt(0n, headNumber - BigInt(row.next_block) + 1n).toString() })),
    prices: prices.rows.map((row) => ({ status: row.status, count: Number(row.count), oldestAgeSeconds: Math.max(0, Number(row.oldest_age_seconds)), nearestExpirySeconds: Number(row.nearest_expiry_seconds) })),
  };
}

function poolMetrics(pool: Pool) { return { total: pool.totalCount, idle: pool.idleCount, waiting: pool.waitingCount }; }
function pipelineAlerts(queue: Awaited<ReturnType<typeof readQueueMetrics>>, pipeline: Awaited<ReturnType<typeof readPipelineMetrics>>,
  database: ReturnType<typeof poolMetrics>, env: Readonly<Record<string, string | undefined>>) {
  const alerts: Array<{ code: string; severity: 'warning' | 'critical'; value: number | string; threshold: number | string }> = [];
  if (queue.oldestOutboxAgeSeconds > 180) alerts.push({ code: 'outbox_age_high', severity: 'critical', value: queue.oldestOutboxAgeSeconds, threshold: 180 });
  if ((queue.jobs.dead ?? 0) > 0 || (queue.outbox.dead ?? 0) > 0) alerts.push({ code: 'dead_queue_items', severity: 'critical', value: (queue.jobs.dead ?? 0) + (queue.outbox.dead ?? 0), threshold: 0 });
  if (pipeline.unresolvedSourceConflicts > 0) alerts.push({ code: 'source_conflict', severity: 'critical', value: pipeline.unresolvedSourceConflicts, threshold: 0 });
  const lagThreshold = Number(env.V1_FINALITY_DELAY_BLOCKS ?? '2') + 30;
  for (const checkpoint of [...pipeline.ingestion, ...pipeline.projections]) if (checkpoint.lagBlocks !== null && BigInt(checkpoint.lagBlocks) > BigInt(lagThreshold))
    alerts.push({ code: 'checkpoint_lag_high', severity: 'critical', value: checkpoint.lagBlocks, threshold: lagThreshold });
  if (pipeline.prices.some((price) => price.nearestExpirySeconds <= 0)) alerts.push({ code: 'price_expired', severity: 'warning', value: 1, threshold: 0 });
  const poolMax = Number(env.TG_DB_POOL_MAX ?? '4');
  if (database.waiting > 0 || database.total >= Math.ceil(poolMax * 0.8)) alerts.push({ code: 'database_pool_pressure', severity: 'warning', value: database.total, threshold: Math.ceil(poolMax * 0.8) });
  return alerts;
}
function identifier(value: string) { if (!/^[a-z][a-z0-9_]{0,62}$/.test(value)) throw new Error('invalid database schema name'); return `"${value}"`; }
function maxBigInt(left: bigint, right: bigint) { return left > right ? left : right; }
function elapsed(started: number) { return Math.round((performance.now() - started) * 100) / 100; }
function runtimeGeneration(value: string | undefined): bigint {
  if (value === undefined || !/^(0|[1-9][0-9]{0,18})$/.test(value)) throw new Error('TG_PIPELINE_GENERATION must be a canonical nonnegative integer');
  return BigInt(value);
}
function decimalGeneration(value: unknown): bigint {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]{0,18})$/.test(value)) throw new Error('generation must be a canonical decimal string');
  return BigInt(value);
}
function emitMetric(env: Readonly<Record<string, string | undefined>>, fields: object) {
  console.info(JSON.stringify({ level: 'info', metric: true, service: 'pipeline', environment: environmentName(env.TG_ENVIRONMENT),
    chainId: 46630, deploymentDigest: CURRENT_RELEASE_ID, ...fields }));
}

function environmentName(value: string | undefined): 'preview' | 'test' | 'production' {
  if (value === 'preview' || value === 'production') return value;
  return 'test';
}

export default createPipelineApp();
