import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import pg, { type Pool } from 'pg';
import {
  eventKey, matchesFilter, mergeSources, parseEventFilter, parseSubscriptionLog, serializeTrigger, subscriptionFilters,
  type EventFilter, type PoolBinding, type SourceAddress,
} from './core.ts';

const { Pool: PgPool } = pg;
const required = [
  'CHAIN_RELAY_WS_URL', 'CHAIN_RELAY_HTTP_URL', 'CHAIN_RELAY_DATABASE_URL', 'CHAIN_SOURCE_DATABASE_URL',
  'CHAIN_RELAY_QUEUE_URL', 'CHAIN_RELAY_DESTINATION', 'QUEUE_PUBLISH_TOKEN',
] as const;
for (const key of required) if (!process.env[key]) throw new Error(`${key} is required`);
if (!['test','production'].includes(process.env.TG_ENVIRONMENT??'')) throw new Error('chain relay environment required');

const filter = parseEventFilter(JSON.parse(await readFile(new URL(process.env.TG_ENVIRONMENT==='production'?'../filter.production.json':'../filter.json', import.meta.url), 'utf8')));
if(filter.environment!==process.env.TG_ENVIRONMENT)throw Error('chain relay filter environment mismatch');
const relayPool = new PgPool({ connectionString: process.env.CHAIN_RELAY_DATABASE_URL, max: positiveInteger(process.env.TG_DB_POOL_MAX_CHAIN_RELAY??'4',1,10), connectionTimeoutMillis: 5_000 });
const sourcePool = new PgPool({ connectionString: process.env.CHAIN_SOURCE_DATABASE_URL, max: positiveInteger(process.env.TG_DB_POOL_MAX_CHAIN_RELAY_SOURCE??'2',1,10), connectionTimeoutMillis: 5_000 });
for(const pool of [relayPool,sourcePool])pool.on('error',(error:Error&{code?:string})=>console.error(JSON.stringify({event:'chain_relay_idle_database_error',code:error.code??'unknown'})));
const queueUrl = cleanUrl(process.env.CHAIN_RELAY_QUEUE_URL!);
const destination = new URL(process.env.CHAIN_RELAY_DESTINATION!);
if (destination.protocol !== 'https:' || destination.username || destination.password || destination.hash
  || destination.pathname !== '/v1/webhooks/chain-relay') throw new Error('invalid chain relay destination');
const maxBackfillBlocks = positiveInteger(process.env.CHAIN_RELAY_MAX_BACKFILL_BLOCKS ?? '10000', 1, 100_000);
const backfillChunkBlocks = BigInt(positiveInteger(process.env.CHAIN_RELAY_BACKFILL_CHUNK_BLOCKS ?? '1000', 1, 10_000));
const sourceRefreshMs = positiveInteger(process.env.CHAIN_RELAY_SOURCE_REFRESH_MS ?? '30000', 5_000, 300_000);
const publishConcurrency = positiveInteger(process.env.CHAIN_RELAY_PUBLISH_CONCURRENCY ?? '8', 1, 32);
const recoveryOverlap = BigInt(positiveInteger(process.env.CHAIN_RELAY_RECOVERY_OVERLAP_BLOCKS ?? '12', 1, 1000));
const port = positiveInteger(process.env.PORT ?? '8081', 1, 65_535);

await initialize(relayPool);
let stopping = false;
let ready = false;
let activeSources = 0;
let activePools = 0;
let subscriptionIds: string[] = [];
let lastError: string | null = null;
let reconnects = 0;
let allowedAddresses = new Set<string>();
let allowedPoolIds = new Set<string>();

const healthServer = createServer(async (request, response) => {
  if (request.url !== '/healthz') { response.writeHead(404).end(); return; }
  try {
    const counts = await relayPool.query<{ pending: number; dead: number; oldest_pending_seconds:number }>(
      `SELECT count(*) FILTER (WHERE state IN ('pending','leased'))::int AS pending,
              count(*) FILTER (WHERE state='dead')::int AS dead, coalesce(extract(epoch FROM now()-min(created_at) FILTER(WHERE state IN ('pending','leased'))),0)::float8 AS oldest_pending_seconds FROM chain_relay_events`,
    );
    const healthy = ready && lastError === null && (counts.rows[0]?.dead??0)===0 && (counts.rows[0]?.oldest_pending_seconds??0)<300;
    response.writeHead(healthy ? 200 : 503, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    response.end(JSON.stringify({ ok: healthy, release: await releaseIdentity(), mode: 'filtered-logs', activeSources, activePools, subscriptions: subscriptionIds.length, reconnects,
      pending: counts.rows[0]?.pending ?? 0, dead: counts.rows[0]?.dead ?? 0, oldestPendingSeconds:counts.rows[0]?.oldest_pending_seconds??0,publishConcurrency,lastError }));
  } catch {
    response.writeHead(503, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: false }));
  }
});
healthServer.listen(port);

for (let worker = 0; worker < publishConcurrency; worker++) void publishLoop();
void connectionLoop();

for (const signal of ['SIGTERM', 'SIGINT'] as const) process.on(signal, () => {
  stopping = true;
  ready = false;
  healthServer.close(() => void Promise.all([relayPool.end(), sourcePool.end()]).finally(() => process.exit(0)));
});

async function connectionLoop(): Promise<void> {
  let backoff = 1_000;
  while (!stopping) {
    let client: WsRpcClient | undefined;
    try {
      ready = false;
      subscriptionIds = [];
      const routing = await loadRouting(sourcePool, filter);
      setAllowed(routing);
      client = await WsRpcClient.connect(process.env.CHAIN_RELAY_WS_URL!, handleSubscriptionLog);
      subscriptionIds = await subscribe(client, routing);
      await reconcile(client, routing);
      activeSources = routing.sources.length;
      activePools = routing.pools.length;
      ready = true;
      lastError = null;
      backoff = 1_000;
      let currentRouting = routing;
      while (!stopping && !client.closed) {
        await delay(sourceRefreshMs);
        if (stopping || client.closed) break;
        const nextRouting = await loadRouting(sourcePool, filter);
        if (routingFingerprint(nextRouting) === routingFingerprint(currentRouting)) { await reconcile(client, currentRouting); continue; }
        const currentAddresses = new Set(currentRouting.sources.map(source => source.address));
        const currentPools = new Set(currentRouting.pools.map(pool => pool.poolId));
        const addedSources = nextRouting.sources.filter(source => !currentAddresses.has(source.address));
        const addedPools = nextRouting.pools.filter(pool => !currentPools.has(pool.poolId));
        setAllowed(mergeRouting(currentRouting, nextRouting));
        const nextSubscriptions = await subscribe(client, nextRouting);
        const head = await latestHead(client);
        const additions = [...addedSources, ...addedPools];
        if (additions.length > 0) await backfill({ sources: addedSources, pools: addedPools }, minimumBirthBlock(additions), head.number, false);
        for (const id of subscriptionIds) await client.request<boolean>('eth_unsubscribe', [id]);
        subscriptionIds = nextSubscriptions;
        currentRouting = nextRouting;
        setAllowed(nextRouting);
        activeSources = nextRouting.sources.length;
        activePools = nextRouting.pools.length;
      }
      if (!stopping) throw new Error('Alchemy WebSocket disconnected');
    } catch (error) {
      lastError = error instanceof Error ? error.message.slice(0, 200) : 'chain relay failure';
      reconnects += 1;
      console.error(JSON.stringify({ event: 'chain_relay_disconnected', error: lastError, reconnects }));
    } finally {
      ready = false;
      subscriptionIds = [];
      client?.close();
    }
    if (!stopping) { await delay(backoff); backoff = Math.min(30_000, backoff * 2); }
  }
}

type Routing = { readonly sources: readonly SourceAddress[]; readonly pools: readonly PoolBinding[] };

async function subscribe(client: WsRpcClient, routing: Routing): Promise<string[]> {
  const ids: string[] = [];
  for (const logFilter of subscriptionFilters(filter, routing.sources, routing.pools)) {
    const id = await client.request<string>('eth_subscribe', ['logs', logFilter]);
    if (!/^0x[0-9a-f]+$/i.test(id)) throw new Error('invalid Alchemy subscription id');
    ids.push(id);
  }
  if (ids.length === 0) throw new Error('chain relay has no subscription filters');
  return ids;
}

async function reconcile(client: WsRpcClient, routing: Routing): Promise<void> {
  const head = await latestHead(client);
  const state = await relayPool.query<{ last_block: string }>('SELECT last_block::text FROM chain_relay_state WHERE id=1');
  // last_block means a complete HTTP scan, never a single observed WS log.
  // Rescan the boundary (and recent reorg window), including on first connection.
  const fromBlock = state.rows[0] ? BigInt(state.rows[0].last_block) - recoveryOverlap + 1n : head.number - recoveryOverlap + 1n;
  if (fromBlock <= head.number) await backfill(routing, fromBlock, head.number);
  await advanceState(head.number, head.hash);
}

async function backfill(routing: Routing, requestedFrom: bigint, toBlock: bigint, advanceCheckpoint = true): Promise<void> {
  const fromBlock = requestedFrom < filter.activationBlock ? filter.activationBlock : requestedFrom;
  if (fromBlock > toBlock) return;
  const span = toBlock - fromBlock + 1n;
  if (span > BigInt(maxBackfillBlocks)) throw new Error(`recovery range ${span} exceeds configured maximum`);
  for (let start = fromBlock; start <= toBlock; start += backfillChunkBlocks) {
    const end = start + backfillChunkBlocks - 1n < toBlock ? start + backfillChunkBlocks - 1n : toBlock;
    for (const logFilter of subscriptionFilters(filter, routing.sources, routing.pools)) {
      const logs = await httpRpc<unknown[]>('eth_getLogs', [{ fromBlock: hexQuantity(start), toBlock: hexQuantity(end), ...logFilter }]);
      for (const value of logs) await handleSubscriptionLog(value);
    }
    if (advanceCheckpoint) await advanceState(end, null);
  }
}

async function handleSubscriptionLog(value: unknown): Promise<void> {
  const log = parseSubscriptionLog(value);
  if (!matchesFilter(filter, log, allowedAddresses, allowedPoolIds)) throw new Error('Alchemy emitted a log outside the project filter');
  const head = log.removed ? await httpLatestHead() : { number: log.blockNumber, hash: log.blockHash };
  const payload = serializeTrigger(filter, log, head);
  await relayPool.query(
    `INSERT INTO chain_relay_events(event_key,payload) VALUES($1,$2) ON CONFLICT(event_key) DO NOTHING`,
    [eventKey(log), payload],
  );
}

async function publishLoop(): Promise<void> {
  while (!stopping) {
    let event: { event_key: string; payload: string; attempt: number } | undefined;
    try {
      event = await claimEvent(relayPool);
      if (!event) { await delay(500); continue; }
      const endpoint = `${queueUrl}/v2/publish/${encodeURIComponent(destination.toString())}`;
      const response = await fetch(endpoint, {
        method: 'POST', body: event.payload, redirect: 'error', signal: AbortSignal.timeout(15_000),
        headers: {
          authorization: `Bearer ${process.env.QUEUE_PUBLISH_TOKEN!}`, 'content-type': 'application/json',
          'upstash-deduplication-id': `tg-chain-relay-${event.event_key}`, 'upstash-retries': '5',
        },
      });
      if (!response.ok) throw new Error(`queue publish returned HTTP ${response.status}`);
      await settleBatch(event);
    } catch (error) {
      if (event) await releaseClaim(event, error instanceof Error ? error.message : 'publish failure').catch(()=>undefined);
      await delay(1_000);
    }
  }
}

// Every raw event stays in the inbox. A sealed batch sends one head/range wake-up;
// downstream still independently retrieves and verifies the complete finalized range.
async function claimEvent(pool:Pool):Promise<{event_key:string;payload:string;attempt:number}|undefined>{
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    let batch=(await client.query<{event_key:string;payload:string;attempt:number}>(`WITH picked AS (SELECT batch_key FROM chain_relay_batches WHERE (state='pending' OR (state='leased' AND lease_expires_at<=now())) AND next_attempt_at<=now() ORDER BY next_attempt_at,batch_key FOR UPDATE SKIP LOCKED LIMIT 1) UPDATE chain_relay_batches b SET state='leased',attempt=b.attempt+1,lease_expires_at=now()+interval '30 seconds' FROM picked WHERE b.batch_key=picked.batch_key RETURNING b.batch_key event_key,b.payload,b.attempt`)).rows[0];
    if(!batch){
      const seed=(await client.query<{group_key:string}>(`SELECT group_key FROM chain_relay_events WHERE batch_key IS NULL AND (state='pending' OR (state='leased' AND lease_expires_at<=now())) AND next_attempt_at<=now() ORDER BY next_attempt_at,event_key FOR UPDATE SKIP LOCKED LIMIT 1`)).rows[0];
      if(seed){
        const events=(await client.query<{event_key:string;payload:string}>(`SELECT event_key,payload FROM chain_relay_events WHERE batch_key IS NULL AND group_key=$1 AND (state='pending' OR (state='leased' AND lease_expires_at<=now())) AND next_attempt_at<=now() ORDER BY event_key FOR UPDATE SKIP LOCKED LIMIT 256`,[seed.group_key])).rows;
        const keys=events.map(e=>e.event_key),key=createHash('sha256').update(JSON.stringify(keys)).digest('hex');
        if(!events.length)throw Error('empty relay batch');
        await client.query(`INSERT INTO chain_relay_batches(batch_key,payload,event_count,state,attempt,lease_expires_at) VALUES($1,$2,$3,'leased',1,now()+interval '30 seconds')`,[key,events[0]!.payload,events.length]);
        await client.query(`UPDATE chain_relay_events SET batch_key=$1 WHERE event_key=ANY($2::text[])`,[key,keys]);
        batch={event_key:key,payload:events[0]!.payload,attempt:1};
      }
    }
    if(batch)await client.query(`UPDATE chain_relay_events SET state='leased',attempt=$2,lease_expires_at=now()+interval '30 seconds',updated_at=now() WHERE batch_key=$1`,[batch.event_key,batch.attempt]);
    await client.query('COMMIT');return batch;
  }catch(error){await client.query('ROLLBACK').catch(()=>{});throw error;}finally{client.release();}
}
async function settleBatch(event:{event_key:string;attempt:number}){
  const client=await relayPool.connect();try{await client.query('BEGIN');
    const saved=await client.query(`UPDATE chain_relay_batches SET state='queued',lease_expires_at=NULL,last_error=NULL WHERE batch_key=$1 AND state='leased' AND attempt=$2`,[event.event_key,event.attempt]);
    if(saved.rowCount)await client.query(`UPDATE chain_relay_events SET state='queued',lease_expires_at=NULL,last_error=NULL,updated_at=now() WHERE batch_key=$1 AND state='leased' AND attempt=$2`,[event.event_key,event.attempt]);
    await client.query('COMMIT');
  }catch(error){await client.query('ROLLBACK').catch(()=>{});throw error;}finally{client.release();}
}
async function releaseClaim(event:{event_key:string;attempt:number},error:string){
  const client=await relayPool.connect();try{await client.query('BEGIN');
    const row=(await client.query<{state:string;next_attempt_at:Date}>(`UPDATE chain_relay_batches SET state=CASE WHEN attempt>=8 THEN 'dead' ELSE 'pending' END,lease_expires_at=NULL,last_error=$2,next_attempt_at=now()+(least(300,power(2,attempt))*interval '1 second') WHERE batch_key=$1 AND state='leased' AND attempt=$3 RETURNING state,next_attempt_at`,[event.event_key,error.slice(0,200),event.attempt])).rows[0];
    if(row)await client.query(`UPDATE chain_relay_events SET state=$2,lease_expires_at=NULL,last_error=$3,next_attempt_at=$4,updated_at=now() WHERE batch_key=$1 AND state='leased' AND attempt=$5`,[event.event_key,row.state,error.slice(0,200),row.next_attempt_at,event.attempt]);
    await client.query('COMMIT');
  }catch{await client.query('ROLLBACK').catch(()=>{});}finally{client.release();}
}

async function initialize(pool: Pool): Promise<void> {
  await pool.query(`CREATE TABLE IF NOT EXISTS chain_relay_events (
    event_key text PRIMARY KEY, payload text NOT NULL,
    state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','leased','queued','dead')),
    attempt integer NOT NULL DEFAULT 0, next_attempt_at timestamptz NOT NULL DEFAULT now(), lease_expires_at timestamptz,
    last_error text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
  )`);
  await pool.query(`ALTER TABLE chain_relay_events ADD COLUMN IF NOT EXISTS batch_key text`);
  await pool.query(`ALTER TABLE chain_relay_events ADD COLUMN IF NOT EXISTS group_key text GENERATED ALWAYS AS ((payload::jsonb->'log'->>'blockHash')||':'||(payload::jsonb->'log'->>'removed')||':'||(payload::jsonb->'head'->>'hash')) STORED`);
  await pool.query(`CREATE TABLE IF NOT EXISTS chain_relay_batches(batch_key text PRIMARY KEY,payload text NOT NULL,event_count integer NOT NULL,state text NOT NULL,attempt integer NOT NULL DEFAULT 0,lease_expires_at timestamptz,next_attempt_at timestamptz NOT NULL DEFAULT now(),last_error text)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS chain_relay_unbatched ON chain_relay_events(group_key,next_attempt_at,event_key) WHERE batch_key IS NULL AND state IN ('pending','leased')`);
  await pool.query(`CREATE INDEX IF NOT EXISTS chain_relay_batch_members ON chain_relay_events(batch_key)`);
  await pool.query("CREATE INDEX IF NOT EXISTS chain_relay_events_due_idx ON chain_relay_events(state,next_attempt_at)");
  await pool.query(`CREATE TABLE IF NOT EXISTS chain_relay_state (
    id smallint PRIMARY KEY CHECK(id=1), last_block numeric(78,0) NOT NULL, last_block_hash text, updated_at timestamptz NOT NULL DEFAULT now()
  )`);
}

async function loadRouting(pool: Pool, eventFilter: EventFilter): Promise<Routing> {
  const schema = sqlIdentifier(process.env.TG_DATABASE_SCHEMA ?? 'tickergarden_serverless');
  const result = await pool.query<{ address: string; birth_block: string }>(
    `SELECT address,birth_block::text FROM ${schema}.contract_sources
     WHERE environment=$3 AND chain_id=$1 AND deployment_digest=$2 AND active ORDER BY address`,
    [eventFilter.chainId, eventFilter.releaseId,eventFilter.environment],
  );
  const pools = await pool.query<{ pool_id: string; birth_block: string }>(
    `SELECT lower(r.payload->>'poolId') AS pool_id,r.payload->'source'->>'blockNumber' AS birth_block
     FROM ${schema}.projection_read_records r
     JOIN ${schema}.publication_pointers p USING(environment,chain_id,deployment_digest,scope,revision)
     WHERE r.environment=$4 AND r.chain_id=$1 AND r.deployment_digest=$2 AND r.scope='markets'
       AND r.payload->>'poolId' ~ '^0x[0-9a-fA-F]{64}$' AND r.payload->>'poolId' <> $3
       AND r.payload->'source'->>'blockNumber' ~ '^[0-9]+$' ORDER BY pool_id`,
    [eventFilter.chainId, eventFilter.releaseId, `0x${'0'.repeat(64)}`,eventFilter.environment],
  );
  return {
    sources: mergeSources(eventFilter, result.rows.map((row) => ({ address: row.address.toLowerCase() as `0x${string}`, birthBlock: BigInt(row.birth_block) }))),
    pools: pools.rows.map((row) => ({ poolId: row.pool_id as `0x${string}`, birthBlock: BigInt(row.birth_block) })),
  };
}

function setAllowed(routing: Routing): void {
  allowedAddresses = new Set(routing.sources.map((source) => source.address));
  allowedPoolIds = new Set(routing.pools.map((pool) => pool.poolId));
}

function mergeRouting(left: Routing, right: Routing): Routing {
  const sources = new Map([...left.sources, ...right.sources].map((item) => [item.address, item]));
  const pools = new Map([...left.pools, ...right.pools].map((item) => [item.poolId, item]));
  return { sources: [...sources.values()], pools: [...pools.values()] };
}

function routingFingerprint(routing: Routing): string {
  return JSON.stringify({ sources: routing.sources.map((item) => [item.address, item.birthBlock.toString()]), pools: routing.pools.map((item) => [item.poolId, item.birthBlock.toString()]) });
}

async function advanceState(number: bigint, hash: string | null): Promise<void> {
  await relayPool.query(`INSERT INTO chain_relay_state(id,last_block,last_block_hash) VALUES(1,$1,$2)
    ON CONFLICT(id) DO UPDATE SET last_block=GREATEST(chain_relay_state.last_block,excluded.last_block),
      last_block_hash=CASE WHEN excluded.last_block>=chain_relay_state.last_block THEN excluded.last_block_hash ELSE chain_relay_state.last_block_hash END,
      updated_at=now()`, [number.toString(), hash]);
}

async function latestHead(client: WsRpcClient): Promise<{ number: bigint; hash: `0x${string}` }> {
  const numberHex = await client.request<string>('eth_blockNumber', []);
  return blockHeader(await client.request('eth_getBlockByNumber', [numberHex, false]));
}

async function httpLatestHead(): Promise<{ number: bigint; hash: `0x${string}` }> {
  const numberHex = await httpRpc<string>('eth_blockNumber', []);
  return blockHeader(await httpRpc('eth_getBlockByNumber', [numberHex, false]));
}

function blockHeader(value: unknown): { number: bigint; hash: `0x${string}` } {
  if (!value || typeof value !== 'object') throw new Error('invalid block header');
  const item = value as Record<string, unknown>;
  if (typeof item.number !== 'string' || !/^0x[0-9a-f]+$/i.test(item.number)
    || typeof item.hash !== 'string' || !/^0x[0-9a-f]{64}$/.test(item.hash)) throw new Error('invalid block header');
  return { number: BigInt(item.number), hash: item.hash as `0x${string}` };
}

let requestId = 1000;
async function httpRpc<T>(method: string, params: readonly unknown[]): Promise<T> {
  const response = await fetch(process.env.CHAIN_RELAY_HTTP_URL!, {
    method: 'POST', signal: AbortSignal.timeout(15_000), headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++requestId, method, params }),
  });
  if (!response.ok) throw new Error(`Alchemy RPC returned HTTP ${response.status}`);
  const value = await response.json() as { result?: T; error?: { message?: string } };
  if (value.error || value.result === undefined) throw new Error(`Alchemy RPC ${method} failed`);
  return value.result;
}

class WsRpcClient {
  readonly socket: WebSocket;
  readonly pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>();
  closed = false;
  private nextId = 1;
  private constructor(socket: WebSocket, onLog: (value: unknown) => Promise<void>) {
    this.socket = socket;
    socket.addEventListener('message', (event) => {
      try {
        const value = JSON.parse(String(event.data)) as { id?: number; result?: unknown; error?: { message?: string }; method?: string; params?: { result?: unknown } };
        if (typeof value.id === 'number') {
          const pending = this.pending.get(value.id); if (!pending) return;
          clearTimeout(pending.timer); this.pending.delete(value.id);
          if (value.error) pending.reject(new Error(value.error.message ?? 'Alchemy WebSocket RPC error')); else pending.resolve(value.result);
        } else if (value.method === 'eth_subscription' && value.params?.result !== undefined) {
          void onLog(value.params.result).catch((error) => {
            console.error(JSON.stringify({ event: 'chain_relay_log_rejected', error: error instanceof Error ? error.message : 'unknown' }));
            socket.close(1011, 'log persistence failed');
          });
        }
      } catch { socket.close(1003, 'invalid JSON'); }
    });
    socket.addEventListener('close', () => this.markClosed());
    socket.addEventListener('error', () => this.markClosed());
  }
  static async connect(url: string, onLog: (value: unknown) => Promise<void>): Promise<WsRpcClient> {
    const endpoint = new URL(url);
    if (endpoint.protocol !== 'wss:' || endpoint.username || endpoint.password || endpoint.hash) throw new Error('Alchemy WebSocket URL must use wss');
    const socket = new WebSocket(endpoint);
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { socket.close(); reject(new Error('Alchemy WebSocket open timeout')); }, 15_000);
      socket.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
      socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error('Alchemy WebSocket open failed')); }, { once: true });
    });
    return new WsRpcClient(socket, onLog);
  }
  request<T = unknown>(method: string, params: readonly unknown[]): Promise<T> {
    if (this.closed || this.socket.readyState !== WebSocket.OPEN) return Promise.reject(new Error('Alchemy WebSocket is closed'));
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`Alchemy WebSocket ${method} timeout`)); }, 15_000);
      this.pending.set(id, { resolve: (value) => resolve(value as T), reject, timer });
      this.socket.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
    });
  }
  close(): void { if (!this.closed) this.socket.close(); this.markClosed(); }
  private markClosed(): void {
    if (this.closed) return;
    this.closed = true;
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(new Error('Alchemy WebSocket disconnected')); }
    this.pending.clear();
  }
}

function cleanUrl(value: string): string {
  const url = new URL(value); if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('invalid queue URL');
  return url.toString().replace(/\/$/, '');
}
function positiveInteger(value: string, minimum: number, maximum: number): number {
  const parsed = Number(value); if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) throw new Error('invalid integer configuration'); return parsed;
}
function sqlIdentifier(value: string): string { if (!/^[a-z][a-z0-9_]{0,62}$/.test(value)) throw new Error('invalid database schema'); return `"${value}"`; }
function hexQuantity(value: bigint): `0x${string}` { return `0x${value.toString(16)}`; }
function minimumBirthBlock(sources: readonly { readonly birthBlock: bigint }[]): bigint { return sources.reduce((minimum, source) => source.birthBlock < minimum ? source.birthBlock : minimum, sources[0]!.birthBlock); }
function delay(ms: number): Promise<void> { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function releaseIdentity(){
 const schema=(await relayPool.query<{digest:string;n:number}>(`SELECT md5(string_agg(table_name||':'||column_name||':'||data_type||':'||is_nullable,',' ORDER BY table_name,ordinal_position)) digest,count(DISTINCT table_name)::int n FROM information_schema.columns WHERE table_schema='public' AND table_name=ANY($1::text[])`,[["chain_relay_events", "chain_relay_batches", "chain_relay_state"]])).rows[0];
 return {commit:/^[0-9a-f]{40}$/.test(process.env.TG_RELEASE_COMMIT??'')?process.env.TG_RELEASE_COMMIT:null,imageDigest:/^sha256:[0-9a-f]{64}$/.test(process.env.TG_IMAGE_DIGEST??'')?process.env.TG_IMAGE_DIGEST:null,schemaDigest:schema?.n===3?schema.digest:null};
}
