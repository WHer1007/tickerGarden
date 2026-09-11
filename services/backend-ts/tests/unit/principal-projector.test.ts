import assert from 'node:assert/strict';
import test from 'node:test';
import type { RpcLog } from '../../packages/chain/src/index.ts';
import { fixedF72Sources, type DecodedProtocolEvent } from '../../packages/events/src/index.ts';
import { normalizeGaugePrincipal, replayPrincipal } from '../../packages/principal-projector/src/index.ts';

const asset = `0x${'1'.repeat(64)}` as const;
const market = `0x${'2'.repeat(64)}` as const;
const user = `0x${'3'.repeat(40)}` as const;
const vault = fixedF72Sources().find((item) => item.module === 'UserStockVault')!.address;
const blockHash = `0x${'4'.repeat(64)}` as const;
const transactionHash = `0x${'5'.repeat(64)}` as const;

function event(name: string, index: bigint, args: Record<string, unknown>): DecodedProtocolEvent {
  const log: RpcLog = { address: vault, blockHash, blockNumber: 100n + index, transactionHash, transactionIndex: 0n,
    logIndex: index, data: '0x', topics: [], removed: false };
  return { module: 'UserStockVault', eventName: name, args: { assetUid: asset, user, ...args }, log };
}

test('principal replay conserves deposited, allocated and per-market components without double counting', () => {
  const result = replayPrincipal([
    event('StockDeposited', 0n, { amount: 100n }),
    event('AllocationLocked', 1n, { marketId: market, amount: 40n, userMarketAllocation: 40n, userTotalAllocated: 40n }),
    event('AllocationReleased', 2n, { marketId: market, amount: 10n, userMarketAllocation: 30n, userTotalAllocated: 30n }),
    event('StockWithdrawn', 3n, { amount: 20n }),
    event('AllocationRageQuit', 4n, { marketId: market, amount: 30n }),
  ], 46630, new Map([[asset, vault]]));
  const account = result.accounts.get(`${asset}:${user}`)!;
  assert.deepEqual({ deposited: account.deposited, allocated: account.allocated, free: account.deposited - account.allocated },
    { deposited: 80n, allocated: 30n, free: 50n });
  assert.equal(result.allocations.get(`${asset}:${user}:${market}`)?.amount, 30n);
});

test('principal replay rejects event checkpoint mismatches and conservation failures', () => {
  assert.throws(() => replayPrincipal([
    event('StockDeposited', 0n, { amount: 100n }),
    event('AllocationLocked', 1n, { marketId: market, amount: 40n, userMarketAllocation: 39n, userTotalAllocated: 40n }),
  ], 46630, new Map([[asset, vault]])), /checkpoint mismatch/);
  assert.throws(() => replayPrincipal([event('StockWithdrawn', 0n, { amount: 1n })], 46630, new Map([[asset, vault]])), /conservation/);
});

test('Gauge normalization distinguishes pending and processed activation without adding allocated twice', () => {
  assert.deepEqual(normalizeGaugePrincipal(10n, 5n, 7n, 100n,
    { processed: false, refs: 1n, quoteAccumulator: 0n, memeAccumulator: 0n }),
  { active: '10', pending: '5', activationAt: '7', unlockAt: '100' });
  assert.deepEqual(normalizeGaugePrincipal(10n, 5n, 7n, 100n,
    { processed: true, refs: 1n, quoteAccumulator: 2n, memeAccumulator: 3n }),
  { active: '15', pending: '0', activationAt: null, unlockAt: '100' });
  assert.throws(() => normalizeGaugePrincipal(0n, 5n, 0n, 100n, null), /activation snapshot/);
  assert.throws(() => normalizeGaugePrincipal(5n, 0n, 1n, 100n, null), /retains a generation/);
});
