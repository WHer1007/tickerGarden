import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer as createHttpServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import pg from 'pg';
import { applyCoreMigration, createDatabasePool } from '../../../../services/backend-ts/packages/db/src/index.ts';
import { parseEventFilter } from '../src/core.ts';

const { Client } = pg;
const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const hash = (c: string) => `0x${c.repeat(64)}`;
const databaseUrl = process.env.TG_TEST_DISPLAY_DATABASE_URL ?? 'postgresql:///postgres?host=/tmp';

function assertLocalPostgres(urlText: string): void {
  const url = new URL(urlText);
  const host = (url.searchParams.get('host') ?? url.hostname).toLowerCase();
  const hostaddr = url.searchParams.get('hostaddr')?.toLowerCase();
  const allowedHosts = ['', 'localhost', '127.0.0.1', '::1', '[::1]'];
  if (!['postgres:', 'postgresql:'].includes(url.protocol)
    || !(allowedHosts.includes(host) || host.startsWith('/'))
    || (hostaddr !== undefined && !['127.0.0.1', '::1'].includes(hostaddr))) {
    throw new Error('relay inbox integration test only permits local PostgreSQL');
  }
}

test('relay process persists before notifying, deduplicates, retains removed logs, and reconnects after a missed heartbeat', { timeout: 55_000 }, async (context) => {
  const schema = `tg_relay_inbox_${process.pid}_${randomBytes(4).toString('hex')}`;
  const schemaSqlName = `"${schema}"`;
  assertLocalPostgres(databaseUrl);
  const pool = createDatabasePool(databaseUrl, { max: 2, connectionTimeoutMillis: 3_000 }).pool;
  let processServer: ReturnType<typeof spawn> | undefined;
  let wss: ReturnType<typeof createHttpsServer> | undefined;
  let rpcHttp: ReturnType<typeof createHttpServer> | undefined;
  let queue: ReturnType<typeof createHttpServer> | undefined;
  let listener: InstanceType<typeof Client> | undefined;
  let certDir: string | undefined;
  const upgradedSockets = new Set<import('node:stream').Duplex>();
  try {
    try { await applyCoreMigration(pool, schema); }
    catch (error) {
      if (process.env.TG_TEST_DISPLAY_DATABASE_URL || !['ECONNREFUSED', 'ENOENT', '28P01', '28000'].includes(String((error as { code?: string }).code))) throw error;
      context.skip('Local PostgreSQL unavailable for relay inbox process test'); return;
    }
    const cert = await mkdtemp(path.join(tmpdir(), 'tg-relay-tls-'));
    certDir = cert;
    const certResult = spawnSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', path.join(cert, 'key.pem'), '-out', path.join(cert, 'cert.pem'), '-days', '1', '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1'], { stdio: 'ignore' });
    if (certResult.status !== 0) { context.skip('openssl unavailable for local TLS WebSocket fixture'); return; }
    const key = await readFile(path.join(cert, 'key.pem'));
    const certificate = await readFile(path.join(cert, 'cert.pem'));
    const filter = parseEventFilter(JSON.parse(await readFile(path.join(root, 'filter.json'), 'utf8')));
    const sourceAddress = filter.fixedAddresses[0]!;
    const topic = filter.eventTopics[0]!;
    const log = (removed: boolean) => ({ address: sourceAddress, blockHash: hash('1'), blockNumber: '0x10', transactionHash: hash('2'), transactionIndex: '0x0', logIndex: '0x3', data: '0x', topics: [topic], removed });
    const events = [log(false), log(false), log(true)];
    let wsConnections = 0;
    let heartbeatRequests = 0;

    const rpcHandler = (request: import('node:http').IncomingMessage, response: import('node:http').ServerResponse) => {
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () => {
        const rpc = JSON.parse(Buffer.concat(chunks).toString()) as { id: number; method: string };
        const result = rpc.method === 'eth_chainId' ? '0xb626'
          : rpc.method === 'eth_blockNumber' ? '0x10' : { number: '0x10', hash: hash('1') };
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ jsonrpc: '2.0', id: rpc.id, result }));
      });
    };
    rpcHttp = createHttpServer(rpcHandler);
    rpcHttp.listen(0, '127.0.0.1');
    await once(rpcHttp, 'listening');
    const rpcPort = (rpcHttp.address() as import('node:net').AddressInfo).port;

    queue = createHttpServer((_request, response) => { response.writeHead(200); response.end('OK'); });
    queue.listen(0, '127.0.0.1');
    await once(queue, 'listening');
    const queuePort = (queue.address() as import('node:net').AddressInfo).port;

    wss = createHttpsServer({ key, cert: certificate });
    wss.on('upgrade', (request, socket) => {
      upgradedSockets.add(socket);
      socket.once('close', () => upgradedSockets.delete(socket));
      const connection = ++wsConnections;
      const websocketKey = request.headers['sec-websocket-key'];
      if (!websocketKey) { socket.destroy(); return; }
      const accept = createHash('sha1').update(`${websocketKey}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64');
      socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
      let buffer = Buffer.alloc(0);
      socket.on('data', (chunk: Buffer) => {
        buffer = Buffer.concat([buffer, chunk]);
        while (buffer.length >= 2) {
          const first = buffer[0]!; const second = buffer[1]!;
          let length = second & 0x7f; let offset = 2;
          if (length === 126) { if (buffer.length < 4) return; length = buffer.readUInt16BE(2); offset = 4; }
          else if (length === 127) { if (buffer.length < 10) return; length = Number(buffer.readBigUInt64BE(2)); offset = 10; }
          const masked = (second & 0x80) !== 0;
          if (masked) offset += 4;
          if (buffer.length < offset + length) return;
          let payload = Buffer.from(buffer.subarray(offset, offset + length));
          if (masked) { const mask = buffer.subarray(offset - 4, offset); for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4]!; }
          buffer = buffer.subarray(offset + length);
          if ((first & 0x0f) !== 1) continue;
          const rpc = JSON.parse(payload.toString()) as { id: number; method: string };
          if (rpc.method === 'eth_blockNumber' && connection === 1) { heartbeatRequests++; continue; }
          const result = rpc.method === 'eth_chainId' ? '0xb626'
            : rpc.method === 'eth_subscribe' ? '0x1'
            : rpc.method === 'eth_unsubscribe' ? true
            : rpc.method === 'eth_blockNumber' ? '0x10' : null;
          socket.write(wsFrame(JSON.stringify({ jsonrpc: '2.0', id: rpc.id, result })));
          if (rpc.method === 'eth_subscribe') setTimeout(() => events.forEach((entry) => socket.write(wsFrame(JSON.stringify({ jsonrpc: '2.0', method: 'eth_subscription', params: { subscription: '0x1', result: entry } })))), 20);
        }
      });
    });
    wss.listen(0, '127.0.0.1');
    await once(wss, 'listening');
    const wsPort = (wss.address() as import('node:net').AddressInfo).port;

    const sourceUrl = new URL(databaseUrl);
    sourceUrl.searchParams.set('options', `-c search_path=${schema}`);
    const notifyChannel = `tg_display_wake_${createHash('sha256').update(['test', filter.chainId, filter.releaseId, schema].join(':')).digest('hex').slice(0, 32)}`;
    listener = new Client({ connectionString: sourceUrl.toString() });
    await listener.connect();
    await listener.query(`LISTEN ${notifyChannel}`);
    const observed = new Promise<void>((resolve, reject) => {
      let notifications = 0;
      let checking = Promise.resolve();
      const timer = setTimeout(() => reject(new Error('relay notification timed out')), 20_000);
      listener!.on('notification', (message) => {
        if (!/^\d+$/.test(message.payload ?? '')) return; // Ignore the connection-time recovery wake-up.
        checking = checking.then(async () => {
          try {
            const rows = await listener!.query(`SELECT count(*)::int AS n FROM ${schemaSqlName}.display_event_inbox WHERE deployment_digest=$1`, [filter.releaseId]);
            assert.ok(rows.rows[0]!.n >= 1, 'display inbox row must be committed before pg_notify is observed');
            notifications++;
            if (notifications === events.length) { clearTimeout(timer); resolve(); }
          } catch (error) { clearTimeout(timer); reject(error); }
        });
      });
    });
    void observed.catch(() => undefined);

    const freePortServer = createHttpServer();
    freePortServer.listen(0, '127.0.0.1');
    await once(freePortServer, 'listening');
    const appPort = (freePortServer.address() as import('node:net').AddressInfo).port;
    await new Promise<void>((resolve) => freePortServer.close(() => resolve()));
    const relayUrl = new URL(databaseUrl);
    relayUrl.searchParams.set('options', `-c search_path=${schema}`);
    const childEnv = { ...process.env };
    for (const name of ['CHAIN_RELAY_WS_FALLBACK_URL', 'CHAIN_RELAY_HTTP_FALLBACK_URL', 'CHAIN_RELAY_HTTP_LOG_MAX_BLOCKS']) delete childEnv[name];
    processServer = spawn(process.execPath, ['--experimental-strip-types', 'src/server.ts'], {
      cwd: root, stdio: ['ignore', 'ignore', 'pipe'],
      env: { ...childEnv, NODE_EXTRA_CA_CERTS: path.join(cert, 'cert.pem'), TG_ENVIRONMENT: 'test', TG_DATABASE_SCHEMA: schema,
        CHAIN_RELAY_WS_URL: `wss://127.0.0.1:${wsPort}`, CHAIN_RELAY_HTTP_URL: `http://127.0.0.1:${rpcPort}`,
        CHAIN_RELAY_DATABASE_URL: relayUrl.toString(), CHAIN_SOURCE_DATABASE_URL: sourceUrl.toString(), CHAIN_RELAY_QUEUE_URL: `http://127.0.0.1:${queuePort}`,
        CHAIN_RELAY_DESTINATION: 'https://localhost/v1/webhooks/chain-relay', QUEUE_PUBLISH_TOKEN: 'local-test-token', PORT: String(appPort),
        CHAIN_RELAY_SOURCE_REFRESH_MS: '5000', CHAIN_RELAY_PUBLISH_CONCURRENCY: '1', CHAIN_RELAY_RECOVERY_OWNER: 'display' },
    });
    const errors: string[] = [];
    processServer.stderr?.on('data', (chunk: Buffer) => errors.push(chunk.toString()));
    processServer.once('exit', (code) => { if (code !== null && code !== 0) { /* included in timeout diagnostic */ } });

    const healthUrl = `http://127.0.0.1:${appPort}/healthz`;
    const deadline = Date.now() + 15_000;
    let healthy = false;
    while (Date.now() < deadline && !healthy) {
      if (processServer.exitCode !== null) {
        const counts = await pool.query(`SELECT count(*)::int AS n FROM ${schemaSqlName}.display_event_inbox`).catch(() => ({ rows: [{ n: -1 }] }));
        throw new Error(`relay exited early (inbox=${counts.rows[0]!.n}): ${errors.join('')}`);
      }
      try { healthy = (await fetch(healthUrl)).ok; } catch { /* waiting for listen */ }
      if (!healthy) await wait(100);
    }
    assert.ok(healthy, `relay did not become healthy: ${errors.join('')}`);
    await observed;

    const inboxDeadline = Date.now() + 5_000;
    let inbox;
    do {
      inbox = await pool.query(`SELECT removed,payload FROM ${schemaSqlName}.display_event_inbox WHERE deployment_digest=$1 ORDER BY removed`, [filter.releaseId]);
      if (inbox.rows.length === 2) break;
      await wait(25);
    } while (Date.now() < inboxDeadline);
    assert.equal(inbox.rows.length, 2, 'identical canonical delivery deduplicates while removed variant is retained');
    assert.equal(inbox.rows.find((row: { removed: boolean }) => !row.removed)?.payload.removed, false);
    assert.equal(inbox.rows.find((row: { removed: boolean }) => row.removed)?.payload.removed, true);
    const relayEvents = await pool.query(`SELECT count(*)::int AS n FROM ${schemaSqlName}.chain_relay_events`);
    assert.ok(relayEvents.rows[0]!.n >= 1);

    const reconnectDeadline = Date.now() + 45_000;
    let recovered = false;
    while (Date.now() < reconnectDeadline && !recovered) {
      const response = await fetch(healthUrl);
      const health = await response.json() as { ok: boolean; reconnects: number };
      recovered = health.ok && health.reconnects >= 1;
      if (!recovered) await wait(100);
    }
    assert.ok(heartbeatRequests >= 1, 'active socket must receive a periodic JSON-RPC heartbeat');
    assert.ok(recovered, 'missed heartbeat must close and reconnect the WebSocket');
  } finally {
    if (processServer && processServer.exitCode === null) { processServer.kill('SIGTERM'); await Promise.race([once(processServer, 'exit'), wait(2_000)]); }
    await listener?.end().catch(() => undefined);
    for (const socket of upgradedSockets) socket.destroy();
    for (const server of [wss, rpcHttp, queue]) if (server?.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
    await pool.query(`DROP SCHEMA IF EXISTS ${schemaSqlName} CASCADE`).catch(() => undefined);
    await pool.end();
    if (certDir) await rm(certDir, { recursive: true, force: true });
  }
});

function wsFrame(text: string): Buffer {
  const payload = Buffer.from(text);
  if (payload.length < 126) return Buffer.concat([Buffer.from([0x81, payload.length]), payload]);
  if (payload.length <= 0xffff) { const header = Buffer.alloc(4); header[0] = 0x81; header[1] = 126; header.writeUInt16BE(payload.length, 2); return Buffer.concat([header, payload]); }
  throw new Error('fixture WebSocket frame too large');
}
