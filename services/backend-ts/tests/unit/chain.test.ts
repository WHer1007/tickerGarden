import assert from 'node:assert/strict';
import test from 'node:test';
import { consensusBlock, hexQuantity, isFinalized, parseChainLogTrigger, RpcTransport, toHexQuantity, verifyChainIdentity } from '../../packages/chain/src/index.ts';

function hash(character: string): `0x${string}` {
  return `0x${character.repeat(64)}`;
}

function rpcFetch(handler: (request: { id: number; method: string; params: unknown[] }) => unknown): typeof fetch {
  return async (_input, init) => {
    const request = JSON.parse(String(init?.body)) as { id: number; method: string; params: unknown[] };
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: request.id, result: handler(request) }), { headers: { 'content-type': 'application/json' } });
  };
}

test('RPC transport allows only bounded fixed-block methods', async () => {
  const calls: unknown[] = [];
  const transport = new RpcTransport({ url: 'https://rpc.example', fetch: rpcFetch((request) => {
    calls.push(request);
    if (request.method === 'eth_chainId') return '0xb626';
    if (request.method === 'eth_getBlockByNumber') return { number: request.params[0], hash: hash('1'), parentHash: hash('0'), timestamp: '0x64' };
    if (request.method === 'eth_call') return '0x1234';
    return [];
  }) });
  assert.equal(await transport.chainId(), 46630n);
  assert.equal((await transport.block(1n)).number, 1n);
  await transport.logs({ fromBlock: 1n, toBlock: 10n, addresses: [`0x${'a'.repeat(40)}`] });
  assert.equal(await transport.callAt(`0x${'a'.repeat(40)}`, '0x1234', 7n), '0x1234');
  assert.equal(calls.length, 4);
  await assert.rejects(transport.call('debug_traceBlock', []), /not allowed/);
  await assert.rejects(transport.logs({ fromBlock: 1n, toBlock: 11n, addresses: [`0x${'a'.repeat(40)}`] }), /1 to 10/);
});

test('RPC identity and provider consensus fail closed', async () => {
  const make = (blockHash: string) => new RpcTransport({ url: 'https://rpc.example', fetch: rpcFetch((request) => request.method === 'eth_chainId'
    ? '0xb626'
    : { number: request.params[0], hash: blockHash, parentHash: hash('0'), timestamp: '0x64' }) });
  const primary = make(hash('1'));
  await verifyChainIdentity(primary, 46630n, hash('1'));
  await assert.rejects(verifyChainIdentity(primary, 4663n, hash('1')), /chain ID mismatch/);
  await assert.rejects(consensusBlock(primary, make(hash('2')), 10n), /disagree/);
});

test('finality requires both block and time delay', () => {
  const block = { number: 100n, hash: hash('1'), parentHash: hash('0'), timestamp: 1_000n };
  assert.equal(isFinalized(block, { ...block, number: 102n, timestamp: 1_600n }, 2n, 600n), true);
  assert.equal(isFinalized(block, { ...block, number: 101n, timestamp: 2_000n }, 2n, 600n), false);
  assert.equal(isFinalized(block, { ...block, number: 110n, timestamp: 1_599n }, 2n, 600n), false);
  assert.equal(hexQuantity('0x0'), 0n);
  assert.equal(hexQuantity('0xB626'), 46630n);
  assert.equal(toHexQuantity(46630n), '0xb626');
  assert.throws(() => hexQuantity('0x00'), /invalid/);
});

test('chain relay trigger binds environment, chain and release identity', () => {
  const deployment = { environment: 'test' as const, chainId: 46630 as const, deploymentDigest: hash('a'), activationBlock: 1n };
  const payload = {
    schema: 'tickergarden.chain-log-trigger.v1', environment: 'test', chainId: 46630, releaseId: hash('a'),
    head: { number: '42', hash: hash('b') },
    log: { address: `0x${'1'.repeat(40)}`, blockHash: hash('b'), blockNumber: '42', transactionHash: hash('d'),
      transactionIndex: '0', logIndex: '7', data: '0x', topics: [hash('c')], removed: false },
  };
  assert.deepEqual(parseChainLogTrigger(payload, deployment), {
    number: 42n, hash: hash('b'), removed: false, eventKey: `${hash('b')}:${hash('d')}:7:canonical`,
  });
  assert.throws(() => parseChainLogTrigger({ ...payload, chainId: 4663 }, deployment), /identity mismatch/);
  assert.throws(() => parseChainLogTrigger({ ...payload, releaseId: hash('e') }, deployment), /identity mismatch/);
  assert.throws(() => parseChainLogTrigger({ ...payload, log: { ...payload.log, blockNumber: '0' } }, deployment), /inconsistent/);
});

test('RPC telemetry records provider, bytes, retry and final outcome without endpoint data', async () => {
  const metrics: Array<Record<string, unknown>> = [];
  let calls = 0;
  const transport = new RpcTransport({
    url: 'https://secret-project.rpc.example/private-key', provider: 'alchemy-primary',
    nominalComputeUnits: () => 20, computeUnitSchedule: 'unit-schedule',
    observe: (metric) => metrics.push(metric as unknown as Record<string, unknown>),
    fetch: async (_input, init) => {
      calls += 1;
      if (calls === 1) return new Response('temporary', { status: 502 });
      const request = JSON.parse(String(init?.body)) as { id: number };
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: request.id, result: '0xb626' }));
    },
  });
  assert.equal(await transport.chainId(), 46630n);
  assert.equal(metrics.length, 2);
  assert.deepEqual(metrics.map(({ provider, method, attempt, outcome, retryable }) => ({ provider, method, attempt, outcome, retryable })), [
    { provider: 'alchemy-primary', method: 'eth_chainId', attempt: 1, outcome: 'failed', retryable: true },
    { provider: 'alchemy-primary', method: 'eth_chainId', attempt: 2, outcome: 'succeeded', retryable: false },
  ]);
  for (const metric of metrics) {
    assert.equal(typeof metric.requestBytes, 'number');
    assert.equal(typeof metric.responseBytes, 'number');
    assert.equal(metric.nominalComputeUnits, 20);
    assert.equal(metric.computeUnitSchedule, 'unit-schedule');
    assert.equal(JSON.stringify(metric).includes('private-key'), false);
  }
});
