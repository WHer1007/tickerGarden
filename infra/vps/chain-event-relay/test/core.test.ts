import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { eventKey, matchesFilter, mergeSources, parseEventFilter, parseSubscriptionLog, serializeTrigger, subscriptionFilters, subscriptionParameters } from '../src/core.ts';

const filter = parseEventFilter(JSON.parse(await readFile(new URL('../filter.json', import.meta.url), 'utf8')));
const hash = (character: string): `0x${string}` => `0x${character.repeat(64)}`;

test('versioned filter is narrow and test-only', () => {
  assert.equal(filter.chainId, 46630);
  assert.equal(filter.environment, 'test');
  assert.equal(filter.fixedAddresses.length, 17);
  assert.equal(filter.eventTopics.length, 92);
  const parameters = subscriptionParameters(filter.fixedAddresses, filter.eventTopics) as [string, { address: string[]; topics: string[][] }];
  assert.equal(parameters[0], 'logs');
  assert.deepEqual(parameters[1].topics, [[...filter.eventTopics].sort()]);
  const filters = subscriptionFilters(filter, filter.fixedAddresses.map((address) => ({ address, birthBlock: filter.activationBlock })), []);
  assert.equal(filters.length, 1);
  assert.ok(!(filters[0]!.address as string[]).includes(filter.sharedPoolManager.address));
});

test('subscription log becomes a deterministic signed-relay payload', () => {
  const log = parseSubscriptionLog({
    address: filter.fixedAddresses[0], blockHash: hash('1'), blockNumber: '0x10', transactionHash: hash('2'),
    transactionIndex: '0x0', logIndex: '0x3', data: '0x', topics: [filter.eventTopics[0]], removed: false,
  });
  assert.match(eventKey(log), /:3:canonical$/);
  const payload = JSON.parse(serializeTrigger(filter, log, { number: 16n, hash: hash('1') }));
  assert.equal(payload.schema, 'tickergarden.chain-log-trigger.v1');
  assert.equal(payload.head.number, '16');
  assert.equal(payload.log.logIndex, '3');
});

test('dynamic sources merge by address and earliest birth block', () => {
  const address = filter.fixedAddresses[0]!;
  const dynamicAddress = `0x${'a'.repeat(40)}` as `0x${string}`;
  const merged = mergeSources(filter, [{ address, birthBlock: filter.activationBlock + 10n }, { address: dynamicAddress, birthBlock: 9n }]);
  assert.equal(merged.find((source) => source.address === address)?.birthBlock, filter.activationBlock);
  assert.equal(merged.find((source) => source.address === dynamicAddress)?.birthBlock, 9n);
});

test('malformed or unfiltered logs fail closed', () => {
  assert.throws(() => parseSubscriptionLog({}), /invalid subscription log/);
  assert.throws(() => subscriptionParameters([], filter.eventTopics), /cannot be empty/);
});

test('shared PoolManager swaps require a project pool id in topic1', () => {
  const poolId = hash('a');
  const otherPoolId = hash('b');
  const sources = filter.fixedAddresses.map((address) => ({ address, birthBlock: filter.activationBlock }));
  const filters = subscriptionFilters(filter, sources, [{ poolId, birthBlock: filter.activationBlock }]);
  assert.equal(filters.length, 2);
  assert.deepEqual(filters[1], { address: filter.sharedPoolManager.address, topics: [[filter.sharedPoolManager.swapTopic], [poolId]] });
  const base = { address: filter.sharedPoolManager.address, blockHash: hash('1'), blockNumber: '0x10', transactionHash: hash('2'),
    transactionIndex: '0x0', logIndex: '0x3', data: '0x', removed: false };
  const allowed = new Set(filter.fixedAddresses);
  assert.equal(matchesFilter(filter, parseSubscriptionLog({ ...base, topics: [filter.sharedPoolManager.swapTopic, poolId] }), allowed, new Set([poolId])), true);
  assert.equal(matchesFilter(filter, parseSubscriptionLog({ ...base, topics: [filter.sharedPoolManager.swapTopic, otherPoolId] }), allowed, new Set([poolId])), false);
});
