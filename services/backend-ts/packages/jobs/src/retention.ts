import type { Pool } from 'pg';
import { transaction } from '../../db/src/index.ts';

const IDENTIFIER = /^[a-z][a-z0-9_]{0,62}$/;
const MAX_BATCH_SIZE = 200;
const ALLOWED_KINDS = ['chain-log-trigger', 'chain-backfill', 'projection-continuation'] as const;

export interface QueueRetentionResult {
  readonly acquired: boolean;
  readonly jobsPayloadsCleared: number;
  readonly outboxPayloadsCleared: number;
  readonly inboxBodiesCleared: number;
  readonly attemptsDeleted: number;
}

/**
 * Scrub old queue bodies while retaining the durable identities and digests
 * used by duplicate detection. Every cleanup pass is bounded independently.
 */
export async function retainQueueHistory(
  pool: Pool,
  schemaName = 'tickergarden_serverless',
  batchSize = MAX_BATCH_SIZE,
): Promise<QueueRetentionResult> {
  if (!IDENTIFIER.test(schemaName)) throw new Error('invalid database schema name');
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > MAX_BATCH_SIZE) {
    throw new Error('retention batch size must be between 1 and 200');
  }
  const schema = `"${schemaName}"`;

  return transaction(pool, async client => {
    const lock = await client.query<{ locked: boolean }>(
      'SELECT pg_try_advisory_xact_lock(hashtextextended($1,0)) locked',
      [`queue-retention:${schemaName}`],
    );
    if (!lock.rows[0]?.locked) {
      return { acquired: false, jobsPayloadsCleared: 0, outboxPayloadsCleared: 0, inboxBodiesCleared: 0, attemptsDeleted: 0 };
    }

    const eligibleJob = `j.queue='chain' AND j.kind=ANY($1::text[]) AND j.state='succeeded'
      AND j.updated_at < now()-interval '30 days'
      AND NOT EXISTS (SELECT 1 FROM ${schema}.outbox_messages pending_o
        WHERE pending_o.operation_id=j.operation_id AND pending_o.state<>'sent')`;
    const jobs = await client.query(
      `WITH selected AS (
         SELECT j.id FROM ${schema}.jobs j WHERE ${eligibleJob} AND j.payload<>'{}'::jsonb
         ORDER BY j.updated_at,j.id FOR UPDATE SKIP LOCKED LIMIT $2
       ) UPDATE ${schema}.jobs j SET payload='{}'::jsonb FROM selected WHERE j.id=selected.id`,
      [ALLOWED_KINDS, batchSize],
    );

    const outbox = await client.query(
      `WITH selected AS (
         SELECT o.id FROM ${schema}.outbox_messages o JOIN ${schema}.jobs j USING(operation_id)
         WHERE ${eligibleJob} AND o.state='sent' AND o.payload<>'{}'::jsonb
         ORDER BY o.created_at,o.id FOR UPDATE OF o SKIP LOCKED LIMIT $2
       ) UPDATE ${schema}.outbox_messages o SET payload='{}'::jsonb FROM selected WHERE o.id=selected.id`,
      [ALLOWED_KINDS, batchSize],
    );

    const inbox = await client.query(
      `WITH selected AS (
         SELECT i.id FROM ${schema}.inbox_messages i
         WHERE i.queue='chain' AND i.state='processed'
           AND i.received_at < now()-interval '30 days'
           AND EXISTS (SELECT 1 FROM ${schema}.jobs j WHERE j.queue=i.queue AND j.payload_digest=i.payload_digest)
           AND NOT EXISTS (
             SELECT 1 FROM ${schema}.jobs j WHERE j.queue=i.queue AND j.payload_digest=i.payload_digest
               AND NOT (${eligibleJob})
           )
           AND NOT EXISTS (
             SELECT 1 FROM ${schema}.jobs j JOIN ${schema}.outbox_messages o USING(operation_id)
             WHERE j.queue=i.queue AND j.payload_digest=i.payload_digest AND o.state<>'sent'
           )
           AND i.raw_body<>''
         ORDER BY i.received_at,i.id FOR UPDATE OF i SKIP LOCKED LIMIT $2
       ) UPDATE ${schema}.inbox_messages i SET raw_body='' FROM selected WHERE i.id=selected.id`,
      [ALLOWED_KINDS, batchSize],
    );

    const attempts = await client.query(
      `WITH selected AS (
         SELECT a.id FROM ${schema}.job_attempts a JOIN ${schema}.jobs j ON j.id=a.job_id
         WHERE j.queue='chain' AND j.kind=ANY($1::text[]) AND j.state='succeeded'
           AND j.updated_at < now()-interval '90 days'
           AND NOT EXISTS (SELECT 1 FROM ${schema}.outbox_messages o
             WHERE o.operation_id=j.operation_id AND o.state<>'sent')
           AND a.outcome IN ('leased','succeeded') AND a.error_code IS NULL
         ORDER BY a.started_at,a.id FOR UPDATE OF a SKIP LOCKED LIMIT $2
       ) DELETE FROM ${schema}.job_attempts a USING selected WHERE a.id=selected.id`,
      [ALLOWED_KINDS, batchSize],
    );

    return {
      acquired: true,
      jobsPayloadsCleared: jobs.rowCount ?? 0,
      outboxPayloadsCleared: outbox.rowCount ?? 0,
      inboxBodiesCleared: inbox.rowCount ?? 0,
      attemptsDeleted: attempts.rowCount ?? 0,
    };
  });
}

/** Existing dispatch scheduler drives cleanup; no new connection pool or cron. */
export async function runScheduledQueueRetention(pool:Pool,schemaName='tickergarden_serverless'){
 if(!IDENTIFIER.test(schemaName))throw Error('invalid database schema name');
 const s=`"${schemaName}"`;
 const claimed=await pool.query(`INSERT INTO ${s}.maintenance_runs(name,next_run_at) VALUES('queue-retention',now()+interval '5 minutes') ON CONFLICT(name) DO UPDATE SET next_run_at=excluded.next_run_at WHERE maintenance_runs.next_run_at<=now() RETURNING name`);
 if(!claimed.rowCount)return null;
 const result=await retainQueueHistory(pool,schemaName);
 const backlog=!result.acquired||Object.entries(result).some(([key,value])=>key!=='acquired'&&Number(value)>=MAX_BATCH_SIZE);
 await pool.query(`UPDATE ${s}.maintenance_runs SET next_run_at=now()+$1::interval WHERE name='queue-retention'`,[backlog?'1 minute':'1 hour']);
 return result;
}
