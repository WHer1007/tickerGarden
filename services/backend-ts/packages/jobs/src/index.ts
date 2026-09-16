import { createHash, timingSafeEqual } from 'node:crypto';
import { Client, Receiver } from '@upstash/qstash';
import type { Pool, PoolClient } from 'pg';
import { transaction } from '../../db/src/index.ts';

export type QueueName = 'chain' | 'content';
const IDENTIFIER = /^[a-z][a-z0-9_]{0,62}$/;
const TOKEN = /^[A-Za-z0-9._:-]{1,160}$/;

export class MessageConflictError extends Error {
  override readonly name = 'MessageConflictError';
}

export class StaleQueueGenerationError extends Error {
  override readonly name = 'StaleQueueGenerationError';
}

export interface EnqueueMessage {
  readonly queue: QueueName;
  readonly externalId: string;
  readonly operationId: string;
  readonly kind: string;
  readonly rawBody: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly destinationKey: string;
  readonly maxAttempts?: number;
  readonly generation?: bigint;
}

export interface EnqueueResult {
  readonly duplicate: boolean;
  readonly inboxId: string;
  readonly jobId: string;
  readonly outboxId: string;
}

export interface Lease {
  readonly id: string;
  readonly operationId: string;
  readonly queue: QueueName;
  readonly kind: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly payloadDigest: string;
  readonly generation: string;
  readonly fencing: string;
  readonly attempt: number;
  readonly maxAttempts: number;
  readonly leaseExpiresAt: Date;
}

export interface OutboxLease {
  readonly id: string;
  readonly operationId: string;
  readonly queue: QueueName;
  readonly destinationKey: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly payloadDigest: string;
  readonly fencing: string;
  readonly attempt: number;
  readonly maxAttempts: number;
  readonly leaseExpiresAt: Date;
}

export function sha256(value: string | Buffer): `0x${string}` {
  return `0x${createHash('sha256').update(value).digest('hex')}`;
}

function schemaIdentifier(schemaName: string): string {
  if (!IDENTIFIER.test(schemaName)) throw new Error('invalid database schema name');
  return `"${schemaName}"`;
}

function assertToken(value: string, field: string): void {
  if (!TOKEN.test(value)) throw new Error(`${field} has invalid syntax`);
}

function assertPayload(payload: Readonly<Record<string, unknown>>): void {
  if (Buffer.byteLength(JSON.stringify(payload)) > 65_536) throw new Error('job payload exceeds 64 KiB');
}

export async function enqueueReliableMessage(pool: Pool, message: EnqueueMessage, schemaName = 'tickergarden_serverless'): Promise<EnqueueResult> {
  assertToken(message.externalId, 'externalId');
  assertToken(message.operationId, 'operationId');
  assertToken(message.kind, 'kind');
  assertToken(message.destinationKey, 'destinationKey');
  if (Buffer.byteLength(message.rawBody) > 262_144) throw new Error('raw body exceeds 256 KiB');
  assertPayload(message.payload);
  const maxAttempts = message.maxAttempts ?? 8;
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 32) throw new Error('maxAttempts must be between 1 and 32');
  const schema = schemaIdentifier(schemaName);
  const digest = sha256(message.rawBody);
  const generation = message.generation ?? 0n;
  if (generation < 0n) throw new Error('generation must be nonnegative');

  return transaction(pool, async (client) => {
    await assertActiveGeneration(client, schema, message.queue, generation);
    const insertedInbox = await client.query<{ id: string }>(
      `INSERT INTO ${schema}.inbox_messages(queue,external_id,payload_digest,raw_body)
       VALUES ($1,$2,$3,$4) ON CONFLICT (queue,external_id) DO NOTHING RETURNING id`,
      [message.queue, message.externalId, digest, message.rawBody],
    );
    if (!insertedInbox.rowCount) {
      const existing = await client.query<{ id: string; payload_digest: string }>(
        `SELECT id,payload_digest FROM ${schema}.inbox_messages WHERE queue=$1 AND external_id=$2`,
        [message.queue, message.externalId],
      );
      if (existing.rows[0]?.payload_digest !== digest) throw new MessageConflictError('external message ID was reused with different content');
      const prior = await client.query<{ job_id: string; outbox_id: string }>(
        `SELECT j.id AS job_id,o.id AS outbox_id FROM ${schema}.jobs j
         JOIN ${schema}.outbox_messages o ON o.operation_id=j.operation_id
         WHERE j.operation_id=$1 AND o.destination_key=$2 AND o.payload_digest=$3`,
        [message.operationId, message.destinationKey, digest],
      );
      if (!prior.rows[0]) throw new MessageConflictError('duplicate inbox does not match the requested operation');
      return { duplicate: true, inboxId: existing.rows[0].id, jobId: prior.rows[0].job_id, outboxId: prior.rows[0].outbox_id };
    }

    const insertedJob = await client.query<{ id: string }>(
      `INSERT INTO ${schema}.jobs(operation_id,queue,kind,payload_digest,payload,max_attempts,generation)
       VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (operation_id) DO NOTHING RETURNING id`,
      [message.operationId, message.queue, message.kind, digest, message.payload, maxAttempts, generation.toString()],
    );
    if (!insertedJob.rows[0]) throw new MessageConflictError('operation ID already exists');
    const insertedOutbox = await client.query<{ id: string }>(
      `INSERT INTO ${schema}.outbox_messages(operation_id,queue,destination_key,payload_digest,payload,max_attempts)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [message.operationId, message.queue, message.destinationKey, digest, {
        operationId: message.operationId, kind: message.kind, payloadDigest: digest,
      }, maxAttempts],
    );
    await client.query(`UPDATE ${schema}.inbox_messages SET state='processed',processed_at=now() WHERE id=$1`, [insertedInbox.rows[0]?.id]);
    return {
      duplicate: false,
      inboxId: insertedInbox.rows[0]!.id,
      jobId: insertedJob.rows[0].id,
      outboxId: insertedOutbox.rows[0]!.id,
    };
  });
}

export async function claimJobByOperation(pool: Pool, queue: QueueName, operationId: string, owner: string, leaseMs = 20_000, schemaName = 'tickergarden_serverless', expectedGeneration = 0n): Promise<Lease | null> {
  assertToken(operationId, 'operationId');
  assertToken(owner, 'owner');
  if (!Number.isInteger(leaseMs) || leaseMs < 1_000 || leaseMs > 300_000) throw new Error('leaseMs must be between 1000 and 300000');
  const schema = schemaIdentifier(schemaName);
  return transaction(pool, async (client) => {
    await assertActiveGeneration(client, schema, queue, expectedGeneration);
    if (!await queueModeMatches(client,schema,queue,'qstash')) return null;
    const claimed = await client.query<{
      id: string; operation_id: string; queue: QueueName; kind: string; payload: Readonly<Record<string, unknown>>; payload_digest: string;
      generation: string; fencing: string; attempt: number; max_attempts: number; lease_expires_at: Date;
    }>(
      `UPDATE ${schema}.jobs SET state='leased',lease_owner=$3,lease_expires_at=now()+($4*interval '1 millisecond'),
         fencing=fencing+1,attempt=attempt+1,updated_at=now()
       WHERE queue=$1 AND operation_id=$2 AND state IN ('pending','retry') AND next_attempt_at<=now() AND generation=$5
       RETURNING id,operation_id,queue,kind,payload,payload_digest,generation,fencing,attempt,max_attempts,lease_expires_at`,
      [queue, operationId, owner, leaseMs, expectedGeneration.toString()],
    );
    const row = claimed.rows[0];
    if (!row) return null;
    await client.query(
      `INSERT INTO ${schema}.job_attempts(job_id,queue,fencing,attempt,outcome,started_at) VALUES ($1,$2,$3,$4,'leased',now())`,
      [row.id, row.queue, row.fencing, row.attempt],
    );
    return {
      id: row.id, operationId: row.operation_id, queue: row.queue, kind: row.kind, payload: row.payload,
      payloadDigest: row.payload_digest, generation: row.generation, fencing: row.fencing, attempt: row.attempt,
      maxAttempts: row.max_attempts, leaseExpiresAt: row.lease_expires_at,
    };
  });
}

export async function claimJobs(pool: Pool, queue: QueueName, owner: string, limit = 1, leaseMs = 20_000, schemaName = 'tickergarden_serverless', expectedGeneration = 0n, executionMode: 'qstash' | 'resident' = 'qstash'): Promise<Lease[]> {
  assertToken(owner, 'owner');
  if (!Number.isInteger(limit) || limit < 1 || limit > 20) throw new Error('limit must be between 1 and 20');
  if (!Number.isInteger(leaseMs) || leaseMs < 1_000 || leaseMs > 300_000) throw new Error('leaseMs must be between 1000 and 300000');
  const schema = schemaIdentifier(schemaName);
  return transaction(pool, async (client) => {
    await assertActiveGeneration(client, schema, queue, expectedGeneration);
    if (!await queueModeMatches(client,schema,queue,executionMode)) return [];
    const claimed = await client.query<{
      id: string; operation_id: string; queue: QueueName; kind: string; payload: Readonly<Record<string, unknown>>; payload_digest: string;
      generation: string; fencing: string; attempt: number; max_attempts: number; lease_expires_at: Date;
    }>(
      `WITH candidates AS (
         SELECT id FROM ${schema}.jobs WHERE queue=$1 AND state IN ('pending','retry') AND next_attempt_at<=now() AND generation=$5
         ORDER BY next_attempt_at,id FOR UPDATE SKIP LOCKED LIMIT $2
       )
       UPDATE ${schema}.jobs j SET state='leased',lease_owner=$3,lease_expires_at=now()+($4*interval '1 millisecond'),
         fencing=j.fencing+1,attempt=j.attempt+1,updated_at=now()
       FROM candidates WHERE j.id=candidates.id
       RETURNING j.id,j.operation_id,j.queue,j.kind,j.payload,j.payload_digest,j.generation,j.fencing,j.attempt,j.max_attempts,j.lease_expires_at`,
      [queue, limit, owner, leaseMs, expectedGeneration.toString()],
    );
    for (const row of claimed.rows) {
      await client.query(
        `INSERT INTO ${schema}.job_attempts(job_id,queue,fencing,attempt,outcome,started_at) VALUES ($1,$2,$3,$4,'leased',now())`,
        [row.id, row.queue, row.fencing, row.attempt],
      );
    }
    return claimed.rows.map((row) => ({
      id: row.id, operationId: row.operation_id, queue: row.queue, kind: row.kind, payload: row.payload,
      payloadDigest: row.payload_digest, generation: row.generation, fencing: row.fencing, attempt: row.attempt,
      maxAttempts: row.max_attempts, leaseExpiresAt: row.lease_expires_at,
    }));
  });
}

export async function completeJob(pool: Pool, lease: Lease, owner: string, resultDigest: string, schemaName = 'tickergarden_serverless'): Promise<boolean> {
  assertToken(owner, 'owner');
  if (!/^0x[0-9a-f]{64}$/.test(resultDigest)) throw new Error('resultDigest must be a lowercase SHA-256 hash');
  const schema = schemaIdentifier(schemaName);
  return transaction(pool, async (client) => {
    const updated = await client.query(
      `UPDATE ${schema}.jobs SET state='succeeded',lease_owner=NULL,lease_expires_at=NULL,result_digest=$1,updated_at=now()
       WHERE id=$2 AND state='leased' AND lease_owner=$3 AND fencing=$4 AND generation=$5 AND lease_expires_at>now()`,
      [resultDigest, lease.id, owner, lease.fencing, lease.generation],
    );
    if (!updated.rowCount) return false;
    await client.query(
      `INSERT INTO ${schema}.job_attempts(job_id,queue,fencing,attempt,outcome,started_at,finished_at)
       VALUES ($1,$2,$3,$4,'succeeded',now(),now())`,
      [lease.id, lease.queue, lease.fencing, lease.attempt],
    );
    return true;
  });
}

export function retryDelayMs(attempt: number): number {
  if (!Number.isInteger(attempt) || attempt < 1) throw new Error('attempt must be positive');
  return Math.min(21_600_000, 1_000 * (2 ** Math.min(attempt - 1, 30)));
}

export async function failJob(pool: Pool, lease: Lease, owner: string, errorCode: string, schemaName = 'tickergarden_serverless'): Promise<'retry' | 'dead' | 'stale'> {
  assertToken(owner, 'owner');
  assertToken(errorCode, 'errorCode');
  const schema = schemaIdentifier(schemaName);
  const outcome = lease.attempt >= lease.maxAttempts ? 'dead' : 'retry';
  return transaction(pool, async (client) => {
    const updated = await client.query(
      `UPDATE ${schema}.jobs SET state=$1,lease_owner=NULL,lease_expires_at=NULL,last_error_code=$2,
         next_attempt_at=CASE WHEN $1='retry' THEN now()+($3*interval '1 millisecond') ELSE next_attempt_at END,updated_at=now()
       WHERE id=$4 AND state='leased' AND lease_owner=$5 AND fencing=$6 AND generation=$7`,
      [outcome, errorCode, retryDelayMs(lease.attempt), lease.id, owner, lease.fencing, lease.generation],
    );
    if (!updated.rowCount) return 'stale';
    await client.query(
      `INSERT INTO ${schema}.job_attempts(job_id,queue,fencing,attempt,outcome,error_code,started_at,finished_at)
       VALUES ($1,$2,$3,$4,$5,$6,now(),now())`,
      [lease.id, lease.queue, lease.fencing, lease.attempt, outcome, errorCode],
    );
    return outcome;
  });
}

export async function recoverExpiredLeases(pool: Pool, queue: QueueName, limit = 100, schemaName = 'tickergarden_serverless', expectedGeneration = 0n): Promise<number> {
  if (!Number.isInteger(limit) || limit < 1 || limit > 1_000) throw new Error('limit must be between 1 and 1000');
  const schema = schemaIdentifier(schemaName);
  return transaction(pool, async (client) => {
    await assertActiveGeneration(client, schema, queue, expectedGeneration);
    const recovered = await client.query<{ id: string; queue: QueueName; fencing: string; attempt: number }>(
      `WITH expired AS (
         SELECT id FROM ${schema}.jobs WHERE queue=$1 AND state='leased' AND lease_expires_at<=now() AND generation=$3
         ORDER BY lease_expires_at,id FOR UPDATE SKIP LOCKED LIMIT $2
       )
       UPDATE ${schema}.jobs j SET state=CASE WHEN attempt>=max_attempts THEN 'dead' ELSE 'retry' END,
         lease_owner=NULL,lease_expires_at=NULL,next_attempt_at=now(),last_error_code='lease_expired',updated_at=now()
       FROM expired WHERE j.id=expired.id RETURNING j.id,j.queue,j.fencing,j.attempt`,
      [queue, limit, expectedGeneration.toString()],
    );
    for (const row of recovered.rows) {
      await client.query(
        `INSERT INTO ${schema}.job_attempts(job_id,queue,fencing,attempt,outcome,error_code,started_at,finished_at)
         VALUES ($1,$2,$3,$4,'expired','lease_expired',now(),now())`,
        [row.id, row.queue, row.fencing, row.attempt],
      );
    }
    return recovered.rowCount ?? 0;
  });
}

export async function claimOutbox(pool: Pool, queue: QueueName, owner: string, limit = 1, leaseMs = 20_000, schemaName = 'tickergarden_serverless', expectedGeneration = 0n): Promise<OutboxLease[]> {
  assertToken(owner, 'owner');
  if (!Number.isInteger(limit) || limit < 1 || limit > 20) throw new Error('limit must be between 1 and 20');
  if (!Number.isInteger(leaseMs) || leaseMs < 1_000 || leaseMs > 120_000) throw new Error('leaseMs must be between 1000 and 120000');
  const schema = schemaIdentifier(schemaName);
  return transaction(pool, async (client) => {
    await assertActiveGeneration(client, schema, queue, expectedGeneration);
    if (!await queueModeMatches(client,schema,queue,'qstash')) return [];
    const claimed = await client.query<{
      id: string; operation_id: string; queue: QueueName; destination_key: string; payload: Readonly<Record<string, unknown>>;
      payload_digest: string; fencing: string; attempt: number; max_attempts: number; lease_expires_at: Date;
    }>(
      `WITH candidates AS (
         SELECT o.id FROM ${schema}.outbox_messages o JOIN ${schema}.jobs j ON j.operation_id=o.operation_id
         WHERE o.queue=$1 AND o.state IN ('pending','retry') AND o.next_attempt_at<=now() AND j.generation=$5
         ORDER BY o.next_attempt_at,o.id FOR UPDATE OF o SKIP LOCKED LIMIT $2
       )
       UPDATE ${schema}.outbox_messages o SET state='leased',lease_owner=$3,lease_expires_at=now()+($4*interval '1 millisecond'),
         fencing=o.fencing+1,attempt=o.attempt+1,updated_at=now()
       FROM candidates WHERE o.id=candidates.id
       RETURNING o.id,o.operation_id,o.queue,o.destination_key,o.payload,o.payload_digest,o.fencing,o.attempt,o.max_attempts,o.lease_expires_at`,
      [queue, limit, owner, leaseMs, expectedGeneration.toString()],
    );
    return claimed.rows.map((row) => ({
      id: row.id, operationId: row.operation_id, queue: row.queue, destinationKey: row.destination_key,
      payload: row.payload, payloadDigest: row.payload_digest, fencing: row.fencing, attempt: row.attempt,
      maxAttempts: row.max_attempts, leaseExpiresAt: row.lease_expires_at,
    }));
  });
}

export async function completeOutbox(pool: Pool, lease: OutboxLease, owner: string, providerMessageId: string, schemaName = 'tickergarden_serverless'): Promise<boolean> {
  assertToken(owner, 'owner');
  assertToken(providerMessageId, 'providerMessageId');
  const schema = schemaIdentifier(schemaName);
  const updated = await pool.query(
    `UPDATE ${schema}.outbox_messages SET state='sent',lease_owner=NULL,lease_expires_at=NULL,provider_message_id=$1,updated_at=now()
     WHERE id=$2 AND state='leased' AND lease_owner=$3 AND fencing=$4 AND lease_expires_at>now()`,
    [providerMessageId, lease.id, owner, lease.fencing],
  );
  return updated.rowCount === 1;
}

export async function failOutbox(pool: Pool, lease: OutboxLease, owner: string, errorCode: string, schemaName = 'tickergarden_serverless'): Promise<'retry' | 'dead' | 'stale'> {
  assertToken(owner, 'owner');
  assertToken(errorCode, 'errorCode');
  const schema = schemaIdentifier(schemaName);
  const outcome = lease.attempt >= lease.maxAttempts ? 'dead' : 'retry';
  const updated = await pool.query(
    `UPDATE ${schema}.outbox_messages SET state=$1,lease_owner=NULL,lease_expires_at=NULL,last_error_code=$2,
       next_attempt_at=CASE WHEN $1='retry' THEN now()+($3*interval '1 millisecond') ELSE next_attempt_at END,updated_at=now()
     WHERE id=$4 AND state='leased' AND lease_owner=$5 AND fencing=$6`,
    [outcome, errorCode, retryDelayMs(lease.attempt), lease.id, owner, lease.fencing],
  );
  return updated.rowCount === 1 ? outcome : 'stale';
}

export async function recoverExpiredOutboxLeases(pool: Pool, queue: QueueName, limit = 100, schemaName = 'tickergarden_serverless', expectedGeneration = 0n): Promise<number> {
  if (!Number.isInteger(limit) || limit < 1 || limit > 1_000) throw new Error('limit must be between 1 and 1000');
  const schema = schemaIdentifier(schemaName);
  return transaction(pool, async (client) => {
    await assertActiveGeneration(client, schema, queue, expectedGeneration);
    const recovered = await client.query(
      `WITH expired AS (
         SELECT o.id FROM ${schema}.outbox_messages o JOIN ${schema}.jobs j ON j.operation_id=o.operation_id
         WHERE o.queue=$1 AND o.state='leased' AND o.lease_expires_at<=now() AND j.generation=$3
         ORDER BY o.lease_expires_at,o.id FOR UPDATE OF o SKIP LOCKED LIMIT $2
       )
       UPDATE ${schema}.outbox_messages o SET state=CASE WHEN attempt>=max_attempts THEN 'dead' ELSE 'retry' END,
         lease_owner=NULL,lease_expires_at=NULL,next_attempt_at=now(),last_error_code='lease_expired',updated_at=now()
       FROM expired WHERE o.id=expired.id`,
      [queue, limit, expectedGeneration.toString()],
    );
    return recovered.rowCount ?? 0;
  });
}

export async function verifyQStashRequest(input: {
  readonly body: string; readonly signature: string; readonly url: string;
  readonly currentSigningKey: string; readonly nextSigningKey: string; readonly upstashRegion?: string;
}): Promise<boolean> {
  const receiver = new Receiver({ currentSigningKey: input.currentSigningKey, nextSigningKey: input.nextSigningKey });
  return receiver.verify({
    body: input.body,
    signature: input.signature,
    url: input.url,
    ...(input.upstashRegion ? { upstashRegion: input.upstashRegion } : {}),
  });
}

export async function processSignedJob(input: {
  readonly pool: Pool; readonly queue: QueueName; readonly owner: string; readonly body: string; readonly signature: string; readonly url: string;
  readonly currentSigningKey: string; readonly nextSigningKey: string; readonly upstashRegion?: string; readonly schemaName?: string;
  readonly leaseMs?: number;
  readonly expectedGeneration?: bigint;
  readonly process: (lease: Lease) => Promise<string | Buffer>;
}): Promise<'succeeded' | 'retry' | 'dead' | 'duplicate_or_not_due' | 'stale'> {
  await verifyQStashRequest({
    body: input.body, signature: input.signature, url: input.url, currentSigningKey: input.currentSigningKey,
    nextSigningKey: input.nextSigningKey, ...(input.upstashRegion ? { upstashRegion: input.upstashRegion } : {}),
  });
  const envelope = JSON.parse(input.body) as { operationId?: unknown; kind?: unknown; payloadDigest?: unknown };
  if (typeof envelope.operationId !== 'string' || typeof envelope.kind !== 'string' || typeof envelope.payloadDigest !== 'string') {
    throw new Error('invalid job envelope');
  }
  const lease = await claimJobByOperation(input.pool, input.queue, envelope.operationId, input.owner, input.leaseMs ?? 20_000, input.schemaName, input.expectedGeneration ?? 0n);
  if (!lease) return 'duplicate_or_not_due';
  if (lease.kind !== envelope.kind || lease.payloadDigest !== envelope.payloadDigest) {
    return failJob(input.pool, lease, input.owner, 'envelope_mismatch', input.schemaName);
  }
  try {
    const result = await input.process(lease);
    return await completeJob(input.pool, lease, input.owner, sha256(result), input.schemaName) ? 'succeeded' : 'stale';
  } catch {
    return failJob(input.pool, lease, input.owner, 'processor_failed', input.schemaName);
  }
}

export function createQStashClient(token: string): Client {
  if (!token) throw new Error('QStash token is required');
  return new Client({ token, enableTelemetry: false });
}

export async function publishOutbox(client: Pick<Client, 'publishJSON'>, lease: OutboxLease, destinations: Readonly<Record<string, string>>): Promise<string> {
  const destination = destinations[lease.destinationKey];
  if (!destination) throw new Error('outbox destination is not registered');
  const url = new URL(destination);
  if (url.protocol !== 'https:' || url.username || url.password || url.hash) throw new Error('outbox destination must be a credential-free HTTPS URL');
  const response = await client.publishJSON({
    url: url.toString(), body: lease.payload, deduplicationId: `tg-${lease.id}-${lease.payloadDigest.slice(2, 18)}`,
    retries: 3, timeout: '20s', flowControl: { key: `tickergarden-${lease.queue}`, parallelism: lease.queue === 'chain' ? 4 : 2 },
  });
  return response.messageId;
}

export function verifyRepairToken(provided: string | null, configured: string): boolean {
  if (!provided || !configured) return false;
  const left = Buffer.from(provided);
  const right = Buffer.from(configured);
  return left.length === right.length && timingSafeEqual(left, right);
}

export async function dispatchDueOutbox(input: {
  readonly pool: Pool; readonly queue: QueueName; readonly owner: string; readonly client: Pick<Client, 'publishJSON'>;
  readonly destinations: Readonly<Record<string, string>>; readonly limit?: number; readonly schemaName?: string; readonly expectedGeneration?: bigint;
}): Promise<{ claimed: number; sent: number; retried: number; dead: number; stale: number }> {
  const leases = await claimOutbox(input.pool, input.queue, input.owner, input.limit ?? 4, 20_000, input.schemaName, input.expectedGeneration ?? 0n);
  const result = { claimed: leases.length, sent: 0, retried: 0, dead: 0, stale: 0 };
  await Promise.all(leases.map(async (lease) => {
    try {
      const messageId = await publishOutbox(input.client, lease, input.destinations);
      if (await completeOutbox(input.pool, lease, input.owner, messageId, input.schemaName)) result.sent += 1;
      else result.stale += 1;
    } catch {
      const outcome = await failOutbox(input.pool, lease, input.owner, 'provider_publish_failed', input.schemaName);
      if (outcome === 'retry') result.retried += 1;
      else if (outcome === 'dead') result.dead += 1;
      else result.stale += 1;
    }
  }));
  return result;
}

export async function repairQueue(pool: Pool, queue: QueueName, schemaName?: string, expectedGeneration = 0n): Promise<{ jobs: number; outbox: number; requeued: number }> {
  const [jobs, outbox] = await Promise.all([
    recoverExpiredLeases(pool, queue, 100, schemaName, expectedGeneration),
    recoverExpiredOutboxLeases(pool, queue, 100, schemaName, expectedGeneration),
  ]);
  const requeued = await requeueDueJobs(pool, queue, 100, schemaName, expectedGeneration);
  return { jobs, outbox, requeued };
}

export async function readQueueMetrics(pool: Pool, queue: QueueName, schemaName = 'tickergarden_serverless'): Promise<{
  queue: QueueName; activeGeneration: string; jobs: Record<string, number>; outbox: Record<string, number>; oldestOutboxAgeSeconds: number;
}> {
  const schema = schemaIdentifier(schemaName);
  const [generation, jobs, outbox, age] = await Promise.all([
    pool.query<{ active_generation: string }>(`SELECT active_generation FROM ${schema}.queue_generations WHERE queue=$1`, [queue]),
    pool.query<{ state: string; count: string }>(`SELECT state,count(*)::text AS count FROM ${schema}.jobs WHERE queue=$1 GROUP BY state`, [queue]),
    pool.query<{ state: string; count: string }>(`SELECT state,count(*)::text AS count FROM ${schema}.outbox_messages WHERE queue=$1 GROUP BY state`, [queue]),
    pool.query<{ age: string }>(`SELECT COALESCE(EXTRACT(EPOCH FROM now()-min(created_at)),0)::text AS age FROM ${schema}.outbox_messages WHERE queue=$1 AND state IN ('pending','retry','leased')`, [queue]),
  ]);
  if (!generation.rows[0]) throw new Error('queue generation is not initialized');
  return { queue, activeGeneration: generation.rows[0].active_generation, jobs: Object.fromEntries(jobs.rows.map((row) => [row.state, Number(row.count)])),
    outbox: Object.fromEntries(outbox.rows.map((row) => [row.state, Number(row.count)])),
    oldestOutboxAgeSeconds: Math.max(0, Number(age.rows[0]?.age ?? 0)) };
}

export async function requeueDueJobs(pool: Pool, queue: QueueName, limit = 100, schemaName = 'tickergarden_serverless', expectedGeneration = 0n): Promise<number> {
  if (!Number.isInteger(limit) || limit < 1 || limit > 1_000) throw new Error('limit must be between 1 and 1000');
  const schema = schemaIdentifier(schemaName);
  return transaction(pool, async (client) => {
    await assertActiveGeneration(client, schema, queue, expectedGeneration);
    const result = await client.query(
      `WITH due AS (
         SELECT j.id,j.operation_id,j.payload_digest,j.max_attempts,
           (SELECT o.destination_key FROM ${schema}.outbox_messages o WHERE o.operation_id=j.operation_id ORDER BY o.created_at DESC,o.id DESC LIMIT 1) AS destination_key
         FROM ${schema}.jobs j
         WHERE j.queue=$1 AND j.state='retry' AND j.next_attempt_at<=now() AND j.generation=$3
           AND NOT EXISTS (SELECT 1 FROM ${schema}.outbox_messages active WHERE active.operation_id=j.operation_id AND active.state IN ('pending','retry','leased'))
         ORDER BY j.next_attempt_at,j.id FOR UPDATE SKIP LOCKED LIMIT $2
       )
       INSERT INTO ${schema}.outbox_messages(operation_id,queue,destination_key,payload_digest,payload,max_attempts)
       SELECT operation_id,$1,destination_key,payload_digest,
         jsonb_build_object('operationId',operation_id,'kind',(SELECT kind FROM ${schema}.jobs WHERE id=due.id),'payloadDigest',payload_digest),max_attempts
       FROM due WHERE destination_key IS NOT NULL`,
      [queue, limit, expectedGeneration.toString()],
    );
    return result.rowCount ?? 0;
  });
}

export async function advanceQueueGeneration(pool: Pool, queue: QueueName, expectedGeneration: bigint, nextGeneration: bigint,
  schemaName = 'tickergarden_serverless'): Promise<void> {
  if (expectedGeneration < 0n || nextGeneration !== expectedGeneration + 1n) throw new Error('queue generation must advance by exactly one');
  const schema = schemaIdentifier(schemaName);
  await transaction(pool, async (client) => {
    await assertActiveGeneration(client, schema, queue, expectedGeneration, 'update');
    const pending = await client.query<{ count: string }>(
      `SELECT count(*)::text count FROM ${schema}.jobs j
       WHERE j.queue=$1 AND j.generation=$2 AND (j.state <> 'succeeded' OR EXISTS (
         SELECT 1 FROM ${schema}.outbox_messages o WHERE o.operation_id=j.operation_id AND o.state <> 'sent'
       ))`, [queue, expectedGeneration.toString()],
    );
    if (pending.rows[0]?.count !== '0') throw new Error('queue generation cannot advance before successful drain');
    const updated = await client.query(
      `UPDATE ${schema}.queue_generations SET active_generation=$1,updated_at=now() WHERE queue=$2 AND active_generation=$3`,
      [nextGeneration.toString(), queue, expectedGeneration.toString()],
    );
    if (updated.rowCount !== 1) throw new Error('queue generation changed concurrently');
  });
}

async function assertActiveGeneration(client: PoolClient, schema: string, queue: QueueName, expectedGeneration: bigint,
  lock: 'share' | 'update' = 'share'): Promise<void> {
  if (expectedGeneration < 0n) throw new Error('generation must be nonnegative');
  const result = await client.query<{ active_generation: string }>(
    `SELECT active_generation FROM ${schema}.queue_generations WHERE queue=$1 FOR ${lock === 'update' ? 'UPDATE' : 'SHARE'}`, [queue],
  );
  if (!result.rows[0] || BigInt(result.rows[0].active_generation) !== expectedGeneration) throw new StaleQueueGenerationError('runtime queue generation is stale');
}

async function queueModeMatches(client: PoolClient, schema: string, queue: QueueName, mode: 'qstash' | 'resident'): Promise<boolean> {
  return (await client.query<{execution_mode:string}>(`SELECT execution_mode FROM ${schema}.queue_generations WHERE queue=$1`,[queue])).rows[0]?.execution_mode===mode;
}

// Explicit, drain-safe cutover. Pending durable jobs remain available to either runtime.
export async function setQueueExecutionMode(pool:Pool, mode:'qstash'|'resident', expectedGeneration:bigint, schemaName='tickergarden_serverless'):Promise<void>{
 if(mode!=='qstash'&&mode!=='resident')throw Error('invalid execution mode');
 const schema=schemaIdentifier(schemaName);
 await transaction(pool,async client=>{
  await assertActiveGeneration(client,schema,'chain',expectedGeneration,'update');
  const busy=await client.query(`SELECT 1 FROM ${schema}.jobs WHERE queue='chain' AND state='leased' UNION ALL SELECT 1 FROM ${schema}.outbox_messages WHERE queue='chain' AND state='leased' LIMIT 1`);
  if(busy.rowCount)throw Error('execution mode switch requires drained leases');
  await client.query(`UPDATE ${schema}.queue_generations SET execution_mode=$1,updated_at=now() WHERE queue='chain'`,[mode]);
 });
}
