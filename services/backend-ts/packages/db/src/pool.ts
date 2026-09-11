import { attachDatabasePool } from '@vercel/functions';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool, type PoolClient, type PoolConfig } from 'pg';
import * as schema from './schema.ts';

export interface DatabaseHandle {
  readonly pool: Pool;
  readonly db: NodePgDatabase<typeof schema>;
}

export function createDatabasePool(connectionString: string, overrides: PoolConfig = {}): DatabaseHandle {
  if (!connectionString) throw new Error('database connection string is required');
  const max = Number.parseInt(process.env.TG_DB_POOL_MAX ?? '4', 10);
  if (!Number.isSafeInteger(max) || max < 1 || max > 10) throw new Error('TG_DB_POOL_MAX must be between 1 and 10');
  const pool = new Pool({
    connectionString,
    max,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 5_000,
    options: '-c statement_timeout=5000 -c lock_timeout=2000 -c idle_in_transaction_session_timeout=5000',
    ...overrides,
  });
  if (process.env.VERCEL) attachDatabasePool(pool);
  return Object.freeze({ pool, db: drizzle(pool, { schema }) });
}

export async function transaction<T>(pool: Pool, operation: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await operation(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
