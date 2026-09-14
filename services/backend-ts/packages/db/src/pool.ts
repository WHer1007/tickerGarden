import { attachDatabasePool } from '@vercel/functions';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool, type PoolClient, type PoolConfig } from 'pg';
import * as schema from './schema.ts';
import { evaluateConnectionBudget, type ConnectionBudgetInput } from './connection-budget.ts';

export interface DatabaseHandle {
  readonly pool: Pool;
  readonly db: NodePgDatabase<typeof schema>;
}

export function createDatabasePool(connectionString: string, overrides: PoolConfig = {}, runtime?: {role:string; env:Readonly<Record<string,string|undefined>>}): DatabaseHandle {
  if (!connectionString) throw new Error('database connection string is required');
  const env=runtime?.env??process.env;
  const configured=env[runtime ? `TG_DB_POOL_MAX_${runtime.role.toUpperCase().replaceAll('-','_')}` : 'TG_DB_POOL_MAX']??env.TG_DB_POOL_MAX??'4';
  const max=overrides.max??Number(configured);
  if (!Number.isSafeInteger(max) || max < 1 || max > 10) throw new Error('TG_DB_POOL_MAX must be between 1 and 10');
  if(runtime&&env.TG_DB_BUDGET_JSON){
    const budget=JSON.parse(env.TG_DB_BUDGET_JSON) as ConnectionBudgetInput;
    evaluateConnectionBudget(budget);
    const allocation=budget.services.find(item=>item.name===runtime.role);
    if(!allocation||Number(overrides.max??max)>allocation.poolMax)throw Error('service pool exceeds declared connection budget');
  }
  const pool = new Pool({
    connectionString,
    max,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 5_000,
    options: '-c statement_timeout=5000 -c lock_timeout=2000 -c idle_in_transaction_session_timeout=5000',
    ...overrides,
  });
  // pg removes failed idle clients itself. Without this listener EventEmitter
  // terminates the process; the next request should instead acquire a new client.
  pool.on('error', (error: Error & {code?:string}) => {
    console.error(JSON.stringify({level:'error',event:'database_idle_client_error',code:error.code??'unknown'}));
  });
  if (process.env.VERCEL) attachDatabasePool(pool);
  return Object.freeze({ pool, db: drizzle(pool, { schema }) });
}

export async function transaction<T>(pool: Pool, operation: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  let destroy=false;
  try {
    await client.query('BEGIN');
    const result = await operation(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { destroy=true; }
    throw error;
  } finally {
    client.release(destroy);
  }
}
