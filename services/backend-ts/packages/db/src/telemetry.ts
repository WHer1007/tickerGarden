import {performance} from 'node:perf_hooks';
import { AsyncLocalStorage } from 'node:async_hooks';
import { logEvent } from '../../observability/src/index.ts';

export type DatabaseTimingPhase = 'connection' | 'sql';
export type DatabaseTimingCounters = {
  connectionCount: number; queryCount: number; slowQueryCount: number; sqlTimeoutCount: number;
  connectionTimeoutCount: number; taskCount: number; taskFailedCount: number;
  connectionWaitMs: number; sqlMs: number; taskMs: number;
};
type TaskContext = {
  service: string; task: string; connectionWaitMs: number; sqlMs: number; queryCount: number;
  slowQueryCount: number; sqlTimeoutCount: number; connectionTimeoutCount: number;
};
export type DatabaseTelemetryEvent = {
  service: string; level: 'info' | 'warn'; event: string; fields: Record<string, unknown>;
};

export function createDatabaseTelemetry(options: {
  clock?: () => number;
  emit?: (event: DatabaseTelemetryEvent) => void;
} = {}) {
  const clock = options.clock ?? (()=>performance.now());
  const emit = options.emit ?? ((event: DatabaseTelemetryEvent) => logEvent(event.service, event.level, event.event, event.fields));
  const context = new AsyncLocalStorage<TaskContext>();
  const counters: DatabaseTimingCounters = {
    connectionCount: 0, queryCount: 0, slowQueryCount: 0, sqlTimeoutCount: 0,
    connectionTimeoutCount: 0, taskCount: 0, taskFailedCount: 0,
    connectionWaitMs: 0, sqlMs: 0, taskMs: 0,
  };
  const safeEmit = (event: DatabaseTelemetryEvent) => { try { emit(event); } catch { /* instrumentation is non-critical */ } };

  function recordDatabaseTiming(phase: DatabaseTimingPhase, durationMs: number, error?: unknown, queryId?: string, pool?: {poolTotal:number;poolIdle:number;poolWaiting:number}): void {
    try {
      const duration = Number.isFinite(durationMs) ? Math.max(0, durationMs) : 0;
      const current = context.getStore();
      const fields: Record<string, unknown> = { durationMs: duration,...(current?{task:current.task}: {}) };
      if (phase === 'connection') {
        fields.phase='connection';
        if(pool)for(const key of ['poolTotal','poolIdle','poolWaiting'] as const)if(Number.isSafeInteger(pool[key])&&pool[key]>=0)fields[key]=pool[key];
        const message=(error as {message?:unknown}|undefined)?.message;
        if(error) fields.failureStage=message==='Connection terminated due to connection timeout'?'new_connection':message==='timeout exceeded when trying to connect'?'pool_wait':'connection';
        counters.connectionCount++; counters.connectionWaitMs += duration;
        if (current) current.connectionWaitMs += duration;
        if (isConnectionTimeout(error)) {
          counters.connectionTimeoutCount++; if (current) current.connectionTimeoutCount++;
          safeEmit({ service: 'database', level: 'warn', event: 'database_connection_timeout', fields });
        } else if (duration >= 200) safeEmit({ service: 'database', level: 'warn', event: 'database_slow_connection', fields });
        return;
      }
      counters.queryCount++; counters.sqlMs += duration;
      if (current) { current.sqlMs += duration; current.queryCount++; }
      if (duration >= 500) {
        counters.slowQueryCount++; if (current) current.slowQueryCount++;
      }
      if (isSqlTimeout(error)) {
        counters.sqlTimeoutCount++; if (current) current.sqlTimeoutCount++;
        if (safeQueryId(queryId)) fields.queryId = queryId;
        safeEmit({ service: 'database', level: 'warn', event: 'database_query_timeout', fields });
      } else if (duration >= 500) {
        if (safeQueryId(queryId)) fields.queryId = queryId;
        safeEmit({ service: 'database', level: 'warn', event: 'database_slow_query', fields });
      }
    } catch { /* keep instrumentation failures out of the business path */ }
  }

  async function withDatabaseTask<T>(service: string, task: string, run: () => Promise<T>): Promise<T> {
    const startedAt = clock();
    const state: TaskContext = {
      service: safeLabel(service), task: safeLabel(task), connectionWaitMs: 0, sqlMs: 0,
      queryCount: 0, slowQueryCount: 0, sqlTimeoutCount: 0, connectionTimeoutCount: 0,
    };
    counters.taskCount++;
    let outcome: 'succeeded' | 'failed' = 'succeeded';
    try { return await context.run(state, run); }
    catch (error) { outcome = 'failed'; counters.taskFailedCount++; throw error; }
    finally {
      try {
        const taskMs = Math.max(0, clock() - startedAt);
        counters.taskMs += taskMs;
        safeEmit({ service: state.service, level: outcome === 'failed' ? 'warn' : 'info', event: 'database_task', fields: {
          task: state.task, taskMs, connectionWaitMs: state.connectionWaitMs, sqlMs: state.sqlMs,
          queryCount: state.queryCount, slowQueryCount: state.slowQueryCount,
          sqlTimeoutCount: state.sqlTimeoutCount, connectionTimeoutCount: state.connectionTimeoutCount, outcome,
        } });
      } catch { /* preserve the task result */ }
    }
  }
  return { withDatabaseTask, recordDatabaseTiming, databaseTimingSnapshot: () => ({ ...counters }) };
}

const defaultTelemetry = createDatabaseTelemetry();
export const withDatabaseTask = defaultTelemetry.withDatabaseTask;
export const recordDatabaseTiming = defaultTelemetry.recordDatabaseTiming;
export const databaseTimingSnapshot = defaultTelemetry.databaseTimingSnapshot;

function isSqlTimeout(error: unknown): boolean {
  if(!error||typeof error!=='object')return false;
  const {code,message}=error as {code?:unknown;message?:unknown};
  const text=typeof message==='string'?message.slice(0,256).toLowerCase():'';
  // 57014 also includes explicit user cancellation; NOWAIT lock contention is
  // not a timeout either. Count only timed-out operations.
  return code==='57014'&&!text.includes('user request')||code==='55P03'&&text.includes('lock timeout')||text==='query read timeout';
}
function isConnectionTimeout(error: unknown): boolean {
  if (!error || typeof error !== 'object' || !('message' in error) || typeof (error as { message?: unknown }).message !== 'string') return false;
  const message = (error as { message: string }).message.slice(0, 256).toLowerCase();
  return /(?:connection|connect|acquire|pool).{0,48}(?:timeout|timed out)|(?:timeout|timed out).{0,48}(?:connection|connect|acquire|pool)/.test(message);
}
function safeQueryId(value: string | undefined): value is string { return typeof value === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(value); }
function safeLabel(value: string): string { return value.replace(/[^a-zA-Z0-9_.:-]/g, '_').slice(0, 80) || 'unknown'; }
