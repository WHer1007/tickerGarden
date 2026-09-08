import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { parseIntegrationBootstrap, bootstrapSync } from '../src/v1/integrationBootstrap.ts';
import { directReceipt } from '../src/v1/directReceipt.ts';

const raw = JSON.parse(fs.readFileSync(new URL('../public/integration/rh-f72a2cdf.json', import.meta.url), 'utf8')) as Record<string, unknown>;
const address = (n: string) => `0x${n.repeat(40)}` as `0x${string}`;
const contracts = {
  factoryAddress: raw.factory as `0x${string}`,
  launchRouterAddress: (raw.bindings as Record<string, `0x${string}`>).launchRouter!,
  allocationManagerAddress: (raw.bindings as Record<string, `0x${string}`>).allocationManager!,
  protocolFeeVaultAddress: (raw.bindings as Record<string, `0x${string}`>).protocolFeeVault!,
  creatorRevenueRegistryAddress: address('d'),
  treasuryDistributorAddress: address('e'),
};

function compatibleBootstrap(): Record<string, unknown> {
  const copy = structuredClone(raw) as Record<string, unknown>;
  copy.configs = (copy.configs as Array<Record<string, unknown>>).map(c => ({ ...c, source: { ...(c.source as Record<string, unknown>) } }));
  return copy;
}

test('real integration bootstrap is readable and permits zero markets', () => {
  const b = parseIntegrationBootstrap(compatibleBootstrap(), 46630, contracts);
  assert.equal(b.initialMarkets.length, 0);
  const sync = bootstrapSync(b);
  assert.equal(sync.status, 'unavailable');
  assert.equal(sync.finality, 'unavailable');
  assert.equal(sync.blockNumber, null);
  assert.match(sync.revision, /^deployment:0x/);
});

test('integration bootstrap rejects chain, factory, bindings, and missing config', () => {
  for (const mutate of [
    (v: Record<string, unknown>) => { v.chainId = 1; },
    (v: Record<string, unknown>) => { v.factory = address('f'); },
    (v: Record<string, unknown>) => { (v.bindings as Record<string, unknown>).launchRouter = address('a'); },
    (v: Record<string, unknown>) => { v.configs = (v.configs as unknown[]).filter((c: any) => c.kind !== 'quote'); },
  ]) {
    const value = compatibleBootstrap();
    mutate(value);
    assert.throws(() => parseIntegrationBootstrap(value, 46630, contracts));
  }
});

test('directReceipt reads only the submitted hash and succeeds after not-found', async () => {
  const requested: string[] = [];
  let attempts = 0;
  const receipt = { status: 'success' } as any;
  const got = await directReceipt(async hash => { requested.push(hash); if (++attempts === 1) { const e = new Error('not found'); e.name = 'TransactionReceiptNotFoundError'; throw e; } return receipt; }, address('1') as any, 100, 1);
  assert.equal(got, receipt);
  assert.deepEqual(requested, [address('1'), address('1')]);
});

test('directReceipt preserves non-not-found errors and timeout error name', async () => {
  const failure = new Error('rpc failed');
  await assert.rejects(() => directReceipt(async () => { throw failure; }, address('2') as any, 100, 1), e => e === failure);
  await assert.rejects(() => directReceipt(async () => { const e = new Error('not found'); e.name = 'TransactionReceiptNotFoundError'; throw e; }, address('3') as any, 5, 1), e => e instanceof Error && e.name === 'WaitForTransactionReceiptTimeoutError');
});

test('funded stocks have admission evidence and active quotes in this independent release', () => {
  const b = parseIntegrationBootstrap(compatibleBootstrap(), 46630, contracts);
  assert.deepEqual(b.assets.map(a => a.values.tokenSymbol), ['TSLA','AMZN','PLTR','NFLX','AMD']);
  for (const asset of b.assets) {
    assert.equal(asset.values.minimumAllocation, '1000000000000000000');
    const quote=b.configs.find(c => c.kind==='quote' && c.values.quoteAsset===asset.values.stockToken);
    assert.ok(quote);
    assert.equal(quote.values.assetUid,asset.id);
    assert.equal(quote.values.economicsHash,quote.id);
    assert.equal(quote.values.tickerGardenBaselineId,b.configs.find(c=>c.kind==='baseline')!.id);
  }
  for (const patch of [{stockToken:'bad'},{minimumAllocation:'0'},{tokenDecimals:19}]) {
    const value=compatibleBootstrap() as any;
    Object.assign(value.assets[0].values,patch);
    assert.throws(()=>parseIntegrationBootstrap(value,46630,contracts));
  }
});
