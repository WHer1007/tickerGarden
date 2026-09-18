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
