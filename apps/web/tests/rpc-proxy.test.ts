import assert from 'node:assert/strict';
import test from 'node:test';
import { proxyReadRpc } from '../api/rpc.ts';

const endpoint = 'https://tickergarden-web-test.vercel.app/api/rpc';
const origin = 'https://tickergarden-web-test.vercel.app';

test('read RPC proxy forwards an allowed same-origin request without exposing its upstream', async () => {
  let called = false;
  const response = await proxyReadRpc(new Request(endpoint, {
    method: 'POST', headers: { origin, 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }),
  }), { TG_WEB_RPC_URL: 'https://rpc.example/private' }, async (input, init) => {
    called = true;
    assert.equal(String(input), 'https://rpc.example/private');
    assert.equal(init?.method, 'POST');
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: '0xb626' }), { status: 200 });
  });
  assert.equal(called, true);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { jsonrpc: '2.0', id: 1, result: '0xb626' });
});

test('read RPC proxy rejects cross-origin, batch, malformed, and write requests', async () => {
  const request = (body: unknown, requestOrigin = origin) => new Request(endpoint, {
    method: 'POST', headers: { origin: requestOrigin, 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  const environment = { TG_WEB_RPC_URL: 'https://rpc.example/private' };
  const unused = async () => { throw new Error('upstream must not be called'); };

  assert.equal((await proxyReadRpc(request({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }, 'https://evil.example'), environment, unused)).status, 403);
  assert.equal((await proxyReadRpc(request([{ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }]), environment, unused)).status, 400);
  assert.equal((await proxyReadRpc(request({ jsonrpc: '2.0', id: 1, method: 'eth_sendRawTransaction', params: ['0x'] }), environment, unused)).status, 403);
  assert.equal((await proxyReadRpc(new Request(endpoint, { method: 'POST', headers: { origin }, body: '{' }), environment, unused)).status, 400);
});
