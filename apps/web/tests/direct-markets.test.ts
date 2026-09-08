import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { encodeAbiParameters, encodeEventTopics, parseAbiParameters, type Hex } from 'viem';
import { DirectMarkets } from '../src/v1/directMarkets.ts';
import { v1Abis } from '../src/v1/generated/abis.ts';
import { parseIntegrationBootstrap } from '../src/v1/integrationBootstrap.ts';

const raw = JSON.parse(fs.readFileSync(new URL('../public/integration/rh-f72a2cdf.json', import.meta.url), 'utf8')) as any;
const b = parseIntegrationBootstrap(raw, 46630, {
  factoryAddress: raw.factory,
  launchRouterAddress: raw.bindings.launchRouter,
  allocationManagerAddress: raw.bindings.allocationManager,
  protocolFeeVaultAddress: raw.bindings.protocolFeeVault,
  creatorRevenueRegistryAddress: '0xdddddddddddddddddddddddddddddddddddddddd',
  treasuryDistributorAddress: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
});
const id = `0x${'1'.repeat(64)}` as Hex;
const factory = raw.factory as `0x${string}`;
const meme = '0x1111111111111111111111111111111111111111' as `0x${string}`;
const curve = '0x2222222222222222222222222222222222222222' as `0x${string}`;
const gauge = '0x3333333333333333333333333333333333333333' as `0x${string}`;
const quote = '0x0000000000000000000000000000000000000000' as `0x${string}`;
const hash = `0x${'a'.repeat(64)}` as Hex;

function createdLog(address = factory) {
  const args = {
    marketId: id, assetUid: `0x${'2'.repeat(64)}` as Hex, memeToken: meme, curve, gauge, quoteAsset: quote,
    tickerGardenBaselineId: b.configs.find(c => c.kind === 'baseline')!.id as Hex,
    quoteAssetConfigId: b.configs.find(c => c.kind === 'quote')!.id as Hex,
    expectedEconomics: `0x${'3'.repeat(64)}` as Hex,
  };
  const topics = encodeEventTopics({ abi: v1Abis.TickerGardenFactoryV1, eventName: 'MarketCreated', args });
  const data = encodeAbiParameters(parseAbiParameters('address,address,address,bytes32,bytes32,bytes32'), [curve, gauge, quote, args.tickerGardenBaselineId, args.quoteAssetConfigId, args.expectedEconomics]);
  return { address, topics: topics as Hex[], data: data as Hex, blockNumber: 100n, blockHash: hash, transactionHash: `0x${'b'.repeat(64)}` as Hex, transactionIndex: 0, logIndex: 0 };
}

function reader(counter: { calls: number }) {
  return async (_address: any, _abi: any, name: string, _args: readonly unknown[], block: bigint) => {
    counter.calls++;
    assert.equal(block, 120n);
    if (name === 'market') return { config: { assetUid: `0x${'2'.repeat(64)}`, curve, memeToken: meme, gauge, quoteAsset: quote, quoteAssetConfigId: b.configs.find(c => c.kind === 'quote')!.id, tickerGardenBaselineId: b.configs.find(c => c.kind === 'baseline')!.id }, runtime: { sourceVersion: 1, launchPhase: 0, poolId: `0x${'0'.repeat(64)}` } };
    if (name === 'canonicalRoute') return { poolKey: null, swapRouter: raw.bindings.launchRouter, quoter: raw.bindings.launchRouter, hook: raw.bindings.launchRouter, launchLocker: raw.bindings.launchRouter, curveTradingEnabled: true, poolTradingEnabled: false, sourceVersion: 1 };
    if (name === 'graduationExecutor') return raw.bindings.launchRouter;
    if (name === 'readyToGraduate') return false;
    return 0n;
  };
}

test('DirectMarkets observes Factory MarketCreated and reads current head state', async () => {
  const counter = { calls: 0 };
  const dm = new DirectMarkets(b, reader(counter), async () => ({ number: 120n, hash }));
  dm.observe(createdLog());
  const result = await dm.market(id);
  assert.equal(result.observation, 'direct-chain');
  assert.equal(result.sync.finality, 'head');
  assert.equal(result.sync.blockNumber, '120');
  assert.equal(result.market.marketId, id);
  const once = counter.calls;
  await dm.market(id);
  assert.equal(counter.calls, once, '15 second cache should avoid repeated reads');
});

test('DirectMarkets rejects unknown markets and non-Factory same-name events', async () => {
  const dm = new DirectMarkets(b, reader({ calls: 0 }), async () => ({ number: 120n, hash }));
  dm.observe(createdLog('0x9999999999999999999999999999999999999999'));
  await assert.rejects(() => dm.market(id), /not been observed/);
  await assert.rejects(() => dm.market(`0x${'4'.repeat(64)}` as Hex));
});

