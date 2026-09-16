import assert from 'node:assert/strict';
import test from 'node:test';
import { encodeAbiParameters, encodeEventTopics } from 'viem';
import { CURRENT_ACTIVATION_BLOCK, CURRENT_RELEASE_ID, decodeF72Event, eventTopic, f72EventCatalog, fixedF72Sources } from '../../packages/events/src/index.ts';
import type { RpcLog } from '../../packages/chain/src/index.ts';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
const deploymentEvidence = JSON.parse(readFileSync(resolve(import.meta.dirname, '../../../../deployments/releases/0x685b5c20e826f4ddd076b61216c7529a967322082925c4741469b0fda837a7f2/robinhood-testnet-46630.v1.deployed.json'), 'utf8')) as { releaseId: string; factory: string };
const releaseStatus = JSON.parse(readFileSync(resolve(import.meta.dirname, '../../../../deployments/releases/0x685b5c20e826f4ddd076b61216c7529a967322082925c4741469b0fda837a7f2/release-status.json'), 'utf8')) as { activation: { activationBlock: string } };

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
  assert.equal(CURRENT_RELEASE_ID, deploymentEvidence.releaseId);
  assert.equal(CURRENT_ACTIVATION_BLOCK, BigInt(releaseStatus.activation.activationBlock));
  const factory = fixedF72Sources().find((source) => source.module === 'TickerGardenFactoryV1');
  assert.equal(factory?.address, deploymentEvidence.factory.toLowerCase());
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
