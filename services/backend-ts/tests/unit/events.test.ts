import assert from 'node:assert/strict';
import test from 'node:test';
import { encodeAbiParameters, encodeEventTopics } from 'viem';
import { CURRENT_ACTIVATION_BLOCK, CURRENT_RELEASE_ID, decodeF72Event, eventTopic, f72EventCatalog, fixedF72Sources } from '../../packages/events/src/index.ts';
import type { RpcLog } from '../../packages/chain/src/index.ts';

test('current release event catalog decodes MarketCreated and binds fixed deployment identities', () => {
  const topics = encodeEventTopics({
    abi: f72EventCatalog.TickerGardenFactoryV1.abi,
    eventName: 'MarketCreated',
    args: {
      marketId: `0x${'1'.repeat(64)}`,
      assetUid: `0x${'2'.repeat(64)}`,
      memeToken: `0x${'3'.repeat(40)}`,
    },
  });
  const data = encodeAbiParameters(
    [
      { type: 'address' }, { type: 'address' }, { type: 'address' },
      { type: 'bytes32' }, { type: 'bytes32' }, { type: 'bytes32' },
    ],
    [
      `0x${'4'.repeat(40)}`, `0x${'5'.repeat(40)}`, `0x${'6'.repeat(40)}`,
      `0x${'7'.repeat(64)}`, `0x${'8'.repeat(64)}`, `0x${'9'.repeat(64)}`,
    ],
  );
  const log: RpcLog = {
    address: f72EventCatalog.TickerGardenFactoryV1.address,
    blockHash: `0x${'a'.repeat(64)}`, blockNumber: 1n, transactionHash: `0x${'b'.repeat(64)}`,
    transactionIndex: 0n, logIndex: 0n, topics: topics as readonly `0x${string}`[], data, removed: false,
  };
  const decoded = decodeF72Event('TickerGardenFactoryV1', log);
  assert.equal(decoded?.eventName, 'MarketCreated');
  assert.equal(decoded?.args.curve, `0x${'4'.repeat(40)}`);
  assert.equal(topics[0], eventTopic('TickerGardenFactoryV1', 'MarketCreated'));
  assert.equal(CURRENT_RELEASE_ID, '0x5c2c656b1b23e895ea268c34b187cd267e0f4fdcc1759c726cbca7fafb7c9c12');
  assert.equal(CURRENT_ACTIVATION_BLOCK, 117032526n);
  const factory = fixedF72Sources().find((source) => source.module === 'TickerGardenFactoryV1');
  assert.equal(factory?.address, '0x496a3cb9fd8a045c590f311e948b2b4382f17904');
  assert.equal(factory?.birthBlock, CURRENT_ACTIVATION_BLOCK);
});

test('event decoder rejects unknown topics instead of guessing an ABI', () => {
  const log: RpcLog = {
    address: f72EventCatalog.TickerGardenFactoryV1.address,
    blockHash: `0x${'a'.repeat(64)}`, blockNumber: 1n, transactionHash: `0x${'b'.repeat(64)}`,
    transactionIndex: 0n, logIndex: 0n, topics: [`0x${'f'.repeat(64)}`], data: '0x', removed: false,
  };
  assert.equal(decodeF72Event('TickerGardenFactoryV1', log), null);
});
