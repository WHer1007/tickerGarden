import { randomUUID, timingSafeEqual } from 'node:crypto';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import pg from 'pg';
import { signCallback } from './signature.ts';

const { Pool } = pg;
const required = ['QUEUE_DATABASE_URL', 'QUEUE_PUBLISH_TOKEN', 'QUEUE_SIGNING_KEY'] as const;
for (const key of required) if (!process.env[key]) throw new Error(`${key} is required`);

const pool = new Pool({ connectionString: process.env.QUEUE_DATABASE_URL, max: 4, connectionTimeoutMillis: 5_000 });
const publishToken = process.env.QUEUE_PUBLISH_TOKEN!;
const signingKey = process.env.QUEUE_SIGNING_KEY!;
const port = Number(process.env.PORT ?? '8080');
const app = new Hono();

await pool.query(`CREATE TABLE IF NOT EXISTS queue_messages (
  id uuid PRIMARY KEY,
  destination text NOT NULL,
  body text NOT NULL,
  deduplication_id text UNIQUE,
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','leased','delivered','dead')),
  attempt integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 4,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  lease_expires_at timestamptz,
  last_status integer,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
)`);
await pool.query('CREATE INDEX IF NOT EXISTS queue_messages_due_idx ON queue_messages(state,next_attempt_at)');

app.get('/healthz', async (c) => {
  try { await pool.query('SELECT 1'); return c.json({ ok: true }); }
  catch { return c.json({ ok: false }, 503); }
});

app.post('/v2/publish/*', async (c) => {
  if (!authorized(c.req.header('authorization'))) return c.json({ error: 'unauthorized' }, 401);
  const prefix = '/v2/publish/';
  const destination = decodeURIComponent(new URL(c.req.url).pathname.slice(prefix.length));
  if (!validDestination(destination)) return c.json({ error: 'invalid destination' }, 400);
  const body = await c.req.text();
  if (Buffer.byteLength(body) > 1024 * 1024) return c.json({ error: 'body too large' }, 413);
  const dedup = c.req.header('upstash-deduplication-id') ?? null;
  const requestedRetries = Number(c.req.header('upstash-retries') ?? '3');
  const maxAttempts = Number.isInteger(requestedRetries) && requestedRetries >= 0 && requestedRetries <= 10 ? requestedRetries + 1 : 4;
  const id = randomUUID();
  const inserted = await pool.query<{ id: string }>(
    `INSERT INTO queue_messages(id,destination,body,deduplication_id,max_attempts) VALUES($1,$2,$3,$4,$5)
     ON CONFLICT (deduplication_id) DO UPDATE SET updated_at=queue_messages.updated_at RETURNING id`,
    [id, destination, body, dedup, maxAttempts],
  );
  return c.json({ messageId: inserted.rows[0]!.id });
});

function authorized(header: string | undefined): boolean {
  if (!header?.startsWith('Bearer ')) return false;
  const supplied = Buffer.from(header.slice(7));
  const expected = Buffer.from(publishToken);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

function validDestination(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.hash;
  } catch { return false; }
}

type Lease = { id: string; destination: string; body: string; attempt: number; max_attempts: number };
async function claim(): Promise<Lease | undefined> {
  const result = await pool.query<Lease>(`WITH picked AS (
    SELECT id FROM queue_messages
    WHERE (state='pending' OR (state='leased' AND lease_expires_at<=now())) AND next_attempt_at<=now()
    ORDER BY next_attempt_at,id FOR UPDATE SKIP LOCKED LIMIT 1
  ) UPDATE queue_messages q SET state='leased',attempt=q.attempt+1,lease_expires_at=now()+interval '30 seconds',updated_at=now()
    FROM picked WHERE q.id=picked.id RETURNING q.id,q.destination,q.body,q.attempt,q.max_attempts`);
  return result.rows[0];
}

async function deliver(message: Lease): Promise<void> {
  try {
    const response = await fetch(message.destination, {
      method: 'POST', body: message.body,
      headers: { 'content-type': 'application/json', 'upstash-signature': signCallback(message.body, message.destination, signingKey) },
      signal: AbortSignal.timeout(20_000), redirect: 'error',
    });
    if (response.ok) {
      await pool.query("UPDATE queue_messages SET state='delivered',lease_expires_at=NULL,last_status=$2,last_error=NULL,updated_at=now() WHERE id=$1", [message.id, response.status]);
      return;
    }
    await retry(message, response.status, `http_${response.status}`);
  } catch (error) {
    await retry(message, null, error instanceof Error ? error.name : 'delivery_error');
  }
}

async function retry(message: Lease, status: number | null, error: string): Promise<void> {
  const dead = message.attempt >= message.max_attempts;
  const delaySeconds = Math.min(300, 2 ** Math.min(message.attempt, 8));
  await pool.query(`UPDATE queue_messages SET state=$2,lease_expires_at=NULL,last_status=$3,last_error=$4,
    next_attempt_at=now()+($5 * interval '1 second'),updated_at=now() WHERE id=$1`,
  [message.id, dead ? 'dead' : 'pending', status, error.slice(0, 200), delaySeconds]);
}

let stopping = false;
async function work(): Promise<void> {
  while (!stopping) {
    try {
      const message = await claim();
      if (message) await deliver(message);
      else await new Promise((resolve) => setTimeout(resolve, 500));
    } catch { await new Promise((resolve) => setTimeout(resolve, 1_000)); }
  }
}

const server = serve({ fetch: app.fetch, port });
void work();
for (const signal of ['SIGTERM', 'SIGINT'] as const) process.on(signal, () => {
  stopping = true;
  server.close(() => void pool.end().finally(() => process.exit(0)));
});
