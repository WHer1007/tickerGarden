import assert from 'node:assert/strict';
import test from 'node:test';
import { proxyReadRpc } from '../api/rpc.ts';

const endpoint = 'https://tickergarden-web-test.vercel.app/api/rpc';
const origin = 'https://tickergarden-web-test.vercel.app';
const target = '0x0000000000000000000000000000000000000001';
const other = '0x0000000000000000000000000000000000000002';
const topic = `0x${'a'.repeat(64)}`;
const environment = {
  TG_WEB_RPC_URL: 'https://rpc.example/private',
  VITE_V1_READ_API_URL: 'https://read.example/',
  VITE_V1_CHAIN_ID: '4663',
};

function request(body: unknown, ip = '192.0.2.1') {
  return new Request(endpoint, {
    method: 'POST',
    headers: { origin, 'content-type': 'application/json', 'x-vercel-forwarded-for': ip },
    body: JSON.stringify(body),
  });
}

function scopeFetcher(options: { targets?: { address: string; topics: string[] }[]; onRpc?: (call: Record<string, unknown>) => unknown } = {}) {
  let rpcCalls = 0;
  const fetcher: typeof fetch = async (input, init) => {
    const url = String(input);
    if (url.startsWith('https://read.example/v1/rpc-scope?')) {
      assert.equal(init?.method, undefined);
      return Response.json({ chainId: 4663, targets: options.targets ?? [{ address: target, topics: [topic] }] });
    }
    assert.equal(url, environment.TG_WEB_RPC_URL);
    rpcCalls++;
    const call = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return Response.json({ jsonrpc: '2.0', id: 1, result: options.onRpc ? options.onRpc(call) : '0x1' });
  };
  return { fetcher, rpcCalls: () => rpcCalls };
}

test('read RPC proxy forwards an allowed parameterless request without exposing its upstream', async () => {
  const mock = scopeFetcher({ onRpc: () => '0xb626' });
  const response = await proxyReadRpc(request({ jsonrpc: '2.0', id: 1, method: 'eth_chainId' }), environment, mock.fetcher);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { jsonrpc: '2.0', id: 1, result: '0xb626' });
  assert.equal(mock.rpcCalls(), 1);
});

test('healthy primary is called once when fallback is configured', async () => {
  const fallbackEnvironment = { ...environment, TG_WEB_RPC_FALLBACK_URL: 'https://alchemy.example/key-secret' };
  let primary = 0; let secondary = 0;
  const fetcher: typeof fetch = async (input, init) => {
    const url = String(input);
    if (url.startsWith('https://read.example/')) return Response.json({ chainId: 4663, targets: [] });
    if (url === fallbackEnvironment.TG_WEB_RPC_URL) primary++;
    else if (url === fallbackEnvironment.TG_WEB_RPC_FALLBACK_URL) secondary++;
    else assert.fail(`unexpected RPC endpoint: ${url}`);
    return Response.json({ jsonrpc: '2.0', id: 1, result: '0xb626' });
  };
  const response = await proxyReadRpc(request({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }), fallbackEnvironment, fetcher);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { jsonrpc: '2.0', id: 1, result: '0xb626' });
  assert.equal(primary, 1); assert.equal(secondary, 0);
});

test('primary outage retries once on fallback', async () => {
  const fallbackEnvironment = { ...environment, TG_WEB_RPC_FALLBACK_URL: 'https://alchemy.example/key-secret' };
  let primary = 0; let secondary = 0;
  const fetcher: typeof fetch = async (input, init) => {
    const url = String(input);
    if (url.startsWith('https://read.example/')) return Response.json({ chainId: 4663, targets: [] });
    if (url === fallbackEnvironment.TG_WEB_RPC_URL) { primary++; throw Error('network failure with secret'); }
    assert.equal(url, fallbackEnvironment.TG_WEB_RPC_FALLBACK_URL); secondary++;
    const call = JSON.parse(String(init?.body));
    return Response.json({ jsonrpc: '2.0', id: 1, result: call.method === 'eth_chainId' ? '0x1237' : '0xb626' });
  };
  const response = await proxyReadRpc(request({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }), fallbackEnvironment, fetcher);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { jsonrpc: '2.0', id: 1, result: '0x1237' });
  assert.equal(primary, 1); assert.equal(secondary, 2);
});

test('retryable primary failure cools down for 30 seconds and retries after expiry', async () => {
  const fallbackEnvironment = { ...environment, TG_WEB_RPC_FALLBACK_URL: 'https://alchemy.example/key-secret' };
  const realNow = Date.now;
  let now = realNow(); Date.now = () => now;
  let primary = 0; let fallbackReads = 0;
  const fetcher: typeof fetch = async (input, init) => {
    const url = String(input); const body = JSON.parse(String(init?.body));
    if (url.startsWith('https://read.example/')) return Response.json({ chainId: 4663, targets: [] });
    if (url === fallbackEnvironment.TG_WEB_RPC_URL) {
      primary++;
      return primary === 1 ? new Response('busy', { status: 429 }) : Response.json({ jsonrpc: '2.0', id: 1, result: '0x1237' });
    }
    if (body.method === 'eth_chainId') return Response.json({ jsonrpc: '2.0', id: 1, result: '0x1237' });
    fallbackReads++; return Response.json({ jsonrpc: '2.0', id: 1, result: '0x456' });
  };
  try {
    const call = (id: number) => proxyReadRpc(request({ jsonrpc: '2.0', id, method: 'eth_blockNumber', params: [] }), fallbackEnvironment, fetcher);
    assert.equal((await call(1)).status, 200);
    assert.equal((await call(2)).status, 200);
    assert.equal(primary, 1); assert.equal(fallbackReads, 2);
    now += 30001;
    assert.equal((await call(3)).status, 200);
    assert.equal(primary, 2);
  } finally { Date.now = realNow; }
});

test('contract reverts do not trigger fallback', async () => {
  const fallbackEnvironment = { ...environment, TG_WEB_RPC_FALLBACK_URL: 'https://alchemy.example/key-secret' };
  let primary = 0; let secondary = 0;
  const fetcher: typeof fetch = async (input) => {
    const url = String(input);
    if (url.startsWith('https://read.example/')) return Response.json({ chainId: 4663, targets: [{ address: target, topics: [] }] });
    if (url === fallbackEnvironment.TG_WEB_RPC_URL) { primary++; return Response.json({ jsonrpc: '2.0', id: 1, error: { code: 3, message: 'execution reverted' } }); }
    secondary++; return Response.json({ jsonrpc: '2.0', id: 1, result: 'unexpected' });
  };
  const response = await proxyReadRpc(request({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to: target, data: '0x' }, 'latest'] }), fallbackEnvironment, fetcher);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { jsonrpc: '2.0', id: 1, error: { code: 3, message: 'RPC request failed' } });
  assert.equal(primary, 1); assert.equal(secondary, 0);
});

test('invalid configured fallback fails closed before RPC', async () => {
  const mock = scopeFetcher();
  const response = await proxyReadRpc(request({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }), { ...environment, TG_WEB_RPC_FALLBACK_URL: 'http://invalid.example/key-secret' }, mock.fetcher);
  assert.equal(response.status, 503);
  assert.equal(mock.rpcCalls(), 0);
  assert.doesNotMatch(await response.text(), /key-secret|invalid\.example/);
});

test('over-cap numeric log range goes directly to verified fallback and latest range stays on primary', async () => {
  const cappedEnvironment = { ...environment, TG_WEB_RPC_FALLBACK_URL: 'https://alchemy.example/key-secret', TG_WEB_RPC_LOG_MAX_BLOCKS: '5' };
  const endpoints: string[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    const url = String(input);
    if (url.startsWith('https://read.example/')) return Response.json({ chainId: 4663, targets: [{ address: target, topics: [topic] }] });
    const body = JSON.parse(String(init?.body));
    endpoints.push(`${url}:${body.method}`);
    if (url === cappedEnvironment.TG_WEB_RPC_FALLBACK_URL && body.method === 'eth_chainId') return Response.json({ jsonrpc: '2.0', id: 1, result: '0x1237' });
    if (url === cappedEnvironment.TG_WEB_RPC_FALLBACK_URL) return Response.json({ jsonrpc: '2.0', id: 1, result: [] });
    return Response.json({ jsonrpc: '2.0', id: 1, result: [] });
  };
  const ranged = { jsonrpc: '2.0', id: 1, method: 'eth_getLogs', params: [{ address: target, fromBlock: '0x10', toBlock: '0x15', topics: [topic] }] };
  assert.equal((await proxyReadRpc(request(ranged), cappedEnvironment, fetcher)).status, 200);
  assert.deepEqual(endpoints, ['https://alchemy.example/key-secret:eth_chainId', 'https://alchemy.example/key-secret:eth_getLogs']);
  endpoints.length = 0;
  const withinCap = { jsonrpc: '2.0', id: 2, method: 'eth_getLogs', params: [{ address: target, fromBlock: '0x10', toBlock: '0x14', topics: [topic] }] };
  assert.equal((await proxyReadRpc(request(withinCap), cappedEnvironment, fetcher)).status, 200);
  assert.deepEqual(endpoints, ['https://rpc.example/private:eth_getLogs']);
  endpoints.length = 0;
  const latest = { jsonrpc: '2.0', id: 2, method: 'eth_getLogs', params: [{ address: target, fromBlock: 'latest', toBlock: 'latest', topics: [topic] }] };
  assert.equal((await proxyReadRpc(request(latest), cappedEnvironment, fetcher)).status, 200);
  assert.deepEqual(endpoints, ['https://rpc.example/private:eth_getLogs']);
});

test('over-cap logs fail closed without fallback and upstream error text is sanitized', async () => {
  let rpcCalls = 0;
  const fetcher: typeof fetch = async input => {
    if (String(input).startsWith('https://read.example/')) return Response.json({ chainId: 4663, targets: [{ address: target, topics: [topic] }] });
    rpcCalls++;
    return Response.json({ jsonrpc: '2.0', id: 1, error: { code: 3, message: 'private-url-token', data: '0xdeadbeef' } });
  };
  const log = { jsonrpc: '2.0', id: 1, method: 'eth_getLogs', params: [{ address: target, fromBlock: '0x1', toBlock: '0x6', topics: [topic] }] };
  const closed = await proxyReadRpc(request(log), { ...environment, TG_WEB_RPC_LOG_MAX_BLOCKS: '5' }, fetcher);
  assert.equal(closed.status, 502); assert.equal(rpcCalls, 0);
  const regular = await proxyReadRpc(request({ jsonrpc: '2.0', id: 2, method: 'eth_call', params: [{ to: target, data: '0x' }, 'latest'] }), environment, fetcher);
  assert.equal(regular.status, 200);
  assert.deepEqual(await regular.json(), { jsonrpc: '2.0', id: 2, error: { code: 3, message: 'RPC request failed', data: '0xdeadbeef' } });
  assert.equal(rpcCalls, 1);
});

test('fallback chain ID mismatch prevents fallback RPC reads', async () => {
  const cappedEnvironment = { ...environment, TG_WEB_RPC_FALLBACK_URL: 'https://alchemy.example/key-secret', TG_WEB_RPC_LOG_MAX_BLOCKS: '5' };
  let primary = 0; let fallbackMethods: string[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    const url = String(input);
    if (url.startsWith('https://read.example/')) return Response.json({ chainId: 4663, targets: [{ address: target, topics: [topic] }] });
    const call = JSON.parse(String(init?.body));
    if (url === cappedEnvironment.TG_WEB_RPC_URL) primary++;
    else fallbackMethods.push(call.method);
    return Response.json({ jsonrpc: '2.0', id: 1, result: call.method === 'eth_chainId' ? '0x1' : [] });
  };
  const log = { jsonrpc: '2.0', id: 1, method: 'eth_getLogs', params: [{ address: target, fromBlock: '0x1', toBlock: '0x6', topics: [topic] }] };
  const response = await proxyReadRpc(request(log), cappedEnvironment, fetcher);
  assert.equal(response.status, 502); assert.equal(primary, 0); assert.deepEqual(fallbackMethods, ['eth_chainId']);
});

test('fallback failure response is sanitized and malformed primary can fail without endpoint disclosure', async () => {
  const fallbackEnvironment = { ...environment, TG_WEB_RPC_FALLBACK_URL: 'https://alchemy.example/key-secret' };
  const urls: string[] = [];
  const fetcher: typeof fetch = async (input) => {
    const url = String(input); urls.push(url);
    if (url.startsWith('https://read.example/')) return Response.json({ chainId: 4663, targets: [] });
    if (url === fallbackEnvironment.TG_WEB_RPC_URL) return Response.json({ nope: true });
    return new Response('secret key upstream failure', { status: 503 });
  };
  const response = await proxyReadRpc(request({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }), fallbackEnvironment, fetcher);
  assert.equal(response.status, 502);
  const body = await response.text();
  assert.doesNotMatch(body, /key-secret|rpc\.example|alchemy\.example|upstream failure/);
  assert.equal(urls.filter(url => url === fallbackEnvironment.TG_WEB_RPC_URL).length, 1);
  assert.equal(urls.filter(url => url === fallbackEnvironment.TG_WEB_RPC_FALLBACK_URL).length, 1);
});

test('scope lookup allows only the configured call, code, and event target', async () => {
  const mock = scopeFetcher();
  const calls = [
    { jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to: target, data: '0x1234' }, 'latest'] },
    { jsonrpc: '2.0', id: 2, method: 'eth_getCode', params: [target, 'latest'] },
    { jsonrpc: '2.0', id: 3, method: 'eth_getLogs', params: [{ address: target, fromBlock: '0x100', toBlock: '0x110', topics: [topic] }] },
  ];
  for (const call of calls) {
    const response = await proxyReadRpc(request(call), environment, mock.fetcher);
    assert.equal(response.status, 200);
    assert.equal((await response.json() as { id: number }).id, call.id);
  }
  assert.equal(mock.rpcCalls(), 3);
});

test('unscoped calls, code, log targets and event topics never reach the RPC', async () => {
  const mock = scopeFetcher();
  const calls = [
    { jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to: other, data: '0x' }] },
    { jsonrpc: '2.0', id: 2, method: 'eth_getCode', params: [other, 'latest'] },
    { jsonrpc: '2.0', id: 3, method: 'eth_getLogs', params: [{ address: other, fromBlock: '0x1', toBlock: '0x2', topics: [topic] }] },
    { jsonrpc: '2.0', id: 4, method: 'eth_getLogs', params: [{ address: target, fromBlock: '0x1', toBlock: '0x2', topics: [`0x${'b'.repeat(64)}`] }] },
  ];
  for (const call of calls) assert.equal((await proxyReadRpc(request(call), environment, mock.fetcher)).status, 403);
  assert.equal(mock.rpcCalls(), 0);
});

test('rejects call overrides and full transaction objects in block reads before upstream', async () => {
  const mock = scopeFetcher();
  const calls = [
    { jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to: target, data: '0x' }, 'latest', { [target]: { state: {} } }] },
    { jsonrpc: '2.0', id: 2, method: 'eth_getBlockByNumber', params: ['latest', true] },
  ];
  for (const call of calls) assert.equal((await proxyReadRpc(request(call), environment, mock.fetcher)).status, 400);
  assert.equal(mock.rpcCalls(), 0);
});

test('identical concurrent calls share upstream work and restore each request ID', async () => {
  let rpcCalls = 0;
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const fetcher: typeof fetch = async (input, init) => {
    if (String(input).startsWith('https://read.example/')) return Response.json({ chainId: 4663, targets: [] });
    rpcCalls++;
    const sent = JSON.parse(String(init?.body));
    assert.equal(sent.id, 1);
    await gate;
    return Response.json({ jsonrpc: '2.0', id: 1, result: '0xabc' });
  };
  const call = (id: number) => proxyReadRpc(request({ jsonrpc: '2.0', id, method: 'eth_blockNumber', params: [] }), environment, fetcher);
  const a = call(101); const b = call(202);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(rpcCalls, 1);
  release();
  const [ra, rb] = await Promise.all([a, b]);
  assert.deepEqual(await ra.json(), { jsonrpc: '2.0', id: 101, result: '0xabc' });
  assert.deepEqual(await rb.json(), { jsonrpc: '2.0', id: 202, result: '0xabc' });
});

test('rejects transaction results outside project scope', async () => {
  const mock = scopeFetcher({ targets: [], onRpc: () => ({ hash: `0x${'c'.repeat(64)}`, to: other, input: '0x' }) });
  const response = await proxyReadRpc(request({ jsonrpc: '2.0', id: 9, method: 'eth_getTransactionByHash', params: [`0x${'c'.repeat(64)}`] }), environment, mock.fetcher);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { jsonrpc: '2.0', id: 9, error: { code: -32602, message: 'Transaction is outside project scope' } });
  assert.equal(mock.rpcCalls(), 1);
});

test('client and shared rate limits reject requests before calling upstream', async () => {
  const perClient = scopeFetcher();
  for (let i = 0; i < 120; i++) {
    const response = await proxyReadRpc(request({ jsonrpc: '2.0', id: i, method: 'eth_chainId', params: [] }), environment, perClient.fetcher);
    assert.equal(response.status, 200);
  }
  assert.equal((await proxyReadRpc(request({ jsonrpc: '2.0', id: 121, method: 'eth_chainId', params: [] }), environment, perClient.fetcher)).status, 429);
  assert.equal(perClient.rpcCalls(), 120);

  const global = scopeFetcher();
  for (let i = 0; i < 600; i++) {
    const ip = `192.0.2.${Math.floor(i / 120) + 10}`;
    const response = await proxyReadRpc(request({ jsonrpc: '2.0', id: i, method: 'eth_chainId', params: [] }, ip), environment, global.fetcher);
    assert.equal(response.status, 200);
  }
  assert.equal((await proxyReadRpc(request({ jsonrpc: '2.0', id: 601, method: 'eth_chainId', params: [] }, '198.51.100.1'), environment, global.fetcher)).status, 429);
  assert.equal(global.rpcCalls(), 600);
});

test('read RPC proxy rejects cross-origin, malformed, oversized batches, duplicate IDs, and writes', async () => {
  const mock = scopeFetcher();
  const rejected = async (body: unknown, requestOrigin = origin) => proxyReadRpc(new Request(endpoint, {
    method: 'POST', headers: { origin: requestOrigin, 'content-type': 'application/json' }, body: JSON.stringify(body),
  }), environment, mock.fetcher);
  assert.equal((await rejected({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }, 'https://evil.example')).status, 403);
  assert.equal((await rejected([])).status, 400);
  assert.equal((await rejected(Array.from({ length: 21 }, (_, id) => ({ jsonrpc: '2.0', id, method: 'eth_chainId', params: [] })))).status, 400);
  assert.equal((await rejected([{ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }, { jsonrpc: '2.0', id: 1, method: 'eth_blockNumber', params: [] }])).status, 400);
  assert.equal((await rejected({ jsonrpc: '2.0', id: 1, method: 'eth_sendRawTransaction', params: ['0x'] })).status, 403);
  assert.equal((await proxyReadRpc(new Request(endpoint, { method: 'POST', headers: { origin }, body: '{' }), environment, mock.fetcher)).status, 400);
  assert.equal(mock.rpcCalls(), 0);
});
