import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyV1Event,
  createIndexerState,
  getIndexerDescriptor,
  INDEXER_DESCRIPTOR,
  requiredObservations,
  V1_EVENT_ABI,
} from "../src/index.ts";
import type { DecodedV1Event } from "../src/index.ts";
import type { V1EventArgsBySignature, V1EventSignature } from "../src/generated/v1-events.ts";

const id = (value: string): `0x${string}` => `0x${value.padStart(64, "0")}`;
const address = (value: string): `0x${string}` => `0x${value.padStart(40, "0")}`;

function event<Signature extends V1EventSignature>(
  signature: Signature,
  args: V1EventArgsBySignature[Signature],
  logIndex: number,
  overrides: Partial<DecodedV1Event> = {},
): DecodedV1Event {
  return {
    chainId: 4663, blockNumber: 10n, blockHash: id("b"), transactionHash: id("a"),
    transactionIndex: 0, logIndex, emitter: address("1"), signature, args, ...overrides,
  } as DecodedV1Event;
}

test("exports the immutable V1 indexer descriptor", () => {
  assert.deepEqual(getIndexerDescriptor(), {
    chainId: 4663,
    executionSpecId: "V1-EXEC-8",
    status: "reorg-replay-and-reconciliation",
    handlersImplemented: true,
  });
  assert.equal(Object.isFrozen(INDEXER_DESCRIPTOR), true);
});

test("catalog is generated from V1 artifacts and includes the canonical PoolManager Swap", () => {
  assert.equal(V1_EVENT_ABI.length, 71);
  assert.ok(V1_EVENT_ABI.some(({ signature, modules }) =>
    signature === "MarketCreated(bytes32,bytes32,address,address,address,address,bytes32,bytes32,bytes32)" &&
    modules.includes("TickerGardenFactoryV1"),
  ));
  assert.ok(V1_EVENT_ABI.some(({ signature, modules }) =>
    signature === "Swap(bytes32,address,int128,int128,uint160,uint128,int24,uint24)" &&
    modules.includes("UniswapV4PoolManager"),
  ));
});

test("projects config and market facts with complete provenance and canonical IDs", () => {
  const state = createIndexerState();
  applyV1Event(state, event("AssetRegistered(bytes32,address,address,uint8)", {
    assetUid: id("11"), stockToken: address("2"), userStockVault: address("3"), tokenDecimals: 18n,
  }, 0));
  applyV1Event(state, event("AssetMinimumAllocationChanged(bytes32,uint256,uint256,bytes32)", {
    assetUid: id("11"), oldMinimum: 0n, newMinimum: 500_000_000_000_000_000n, reasonHash: id("0"),
  }, 1));
  applyV1Event(state, event("MarketCreated(bytes32,bytes32,address,address,address,address,bytes32,bytes32,bytes32)", {
    marketId: id("22"), assetUid: id("11"), memeToken: address("4"), curve: address("5"), gauge: address("6"),
    quoteAsset: address("7"), ponsBaselineId: id("8"), quoteAssetConfigId: id("9"),
    expectedEconomics: id("10"),
  }, 2));

  const config = state.configs.get(`asset:${id("11")}`);
  const market = state.markets.get(id("22"));
  assert.equal(config?.provenance.blockHash, id("b"));
  assert.equal(config?.provenance.transactionIndex, 0);
  assert.equal(config?.values.minimumAllocation, 500_000_000_000_000_000n);
  assert.equal(market?.values.assetUid, id("11"));
  assert.equal(market?.provenance.logIndex, 2);
  assert.equal(state.events.size, 3);
});

test("projects registered and accepted STOCK fingerprints onto the canonical asset", () => {
  const state = createIndexerState();
  const assetUid = id("11");
  applyV1Event(state, event("AssetRegistered(bytes32,address,address,uint8)", {
    assetUid, stockToken: address("2"), userStockVault: address("3"), tokenDecimals: 18n,
  }, 0));
  applyV1Event(state, event("StockTokenFingerprintRegistered(bytes32,bytes32,address,bytes32,address,bytes32)", {
    assetUid,
    tokenRuntimeCodeHash: id("12"),
    beacon: address("13"),
    beaconRuntimeCodeHash: id("14"),
    implementation: address("15"),
    implementationRuntimeCodeHash: id("16"),
  }, 1));
  applyV1Event(state, event("AssetImplementationAccepted(bytes32,address,address,bytes32,bytes32,bytes32)", {
    assetUid,
    oldImplementation: address("15"),
    newImplementation: address("17"),
    oldImplementationRuntimeCodeHash: id("16"),
    newImplementationRuntimeCodeHash: id("18"),
    reasonHash: id("19"),
  }, 2));

  const config = state.configs.get(`asset:${assetUid}`);
  assert.equal(config?.values.tokenRuntimeCodeHash, id("12"));
  assert.equal(config?.values.beacon, address("13"));
  assert.equal(config?.values.implementation, address("17"));
  assert.equal(config?.values.implementationRuntimeCodeHash, id("18"));
  const accepted = event("AssetImplementationAccepted(bytes32,address,address,bytes32,bytes32,bytes32)", {
    assetUid,
    oldImplementation: address("15"),
    newImplementation: address("17"),
    oldImplementationRuntimeCodeHash: id("16"),
    newImplementationRuntimeCodeHash: id("18"),
    reasonHash: id("19"),
  }, 3);
  assert.deepEqual(requiredObservations(accepted).map(({ kind }) => kind), ["assetIdentity"]);
});

test("correlates each PoolManager Swap only with its following Hook fee by transaction log order", () => {
  const state = createIndexerState();
  const poolId = id("44");
  applyV1Event(state, event("Swap(bytes32,address,int128,int128,uint160,uint128,int24,uint24)", {
    id: poolId, sender: address("a"), amount0: -10n, amount1: 9n, sqrtPriceX96: 1n, liquidity: 2n, tick: 3n, fee: 0n,
  }, 4));
  applyV1Event(state, event("FeeBucketsCredited(bytes32,uint32,address,bytes32,uint256,uint256,uint256,uint256)", {
    marketId: id("33"), creatorEpoch: 1n, feeAsset: address("7"), feeId: id("55"), creatorAmount: 2n,
    stakerAmount: 7n, platformAmount: 1n, activeStock: 50n,
  }, 5));
  applyV1Event(state, event("V4FeeAccrued(bytes32,bytes32,address,uint64,bytes32,uint256,uint256,uint256,uint256)", {
    marketId: id("33"), poolId, feeAsset: address("7"), feeNonce: 1n, feeId: id("55"), base: 1000n,
    totalFee: 10n, lpAmount: 2n, nonLpAmount: 8n,
  }, 6));

  const swap = [...state.swaps.values()][0];
  assert.equal(swap?.provenance.logIndex, 4);
  assert.equal(swap?.hookFeeEventKey, `4663:${id("a")}:6`);
  assert.equal(swap?.feeId, id("55"));
  assert.equal(state.feeCredits.get(id("55"))?.values.totalFee, 10n);
});

test("rejects a Hook fee without a preceding same-transaction Swap", () => {
  const state = createIndexerState();
  assert.throws(() => applyV1Event(state, event("V4FeeAccrued(bytes32,bytes32,address,uint64,bytes32,uint256,uint256,uint256,uint256)", {
    marketId: id("33"), poolId: id("44"), feeAsset: address("7"), feeNonce: 1n, feeId: id("55"), base: 1000n,
    totalFee: 10n, lpAmount: 2n, nonLpAmount: 8n,
  }, 1)), /no preceding unpaired Swap/);
  assert.equal(state.events.size, 0);
});

test("is idempotent for one log and rejects non-duplicate out-of-order input", () => {
  const state = createIndexerState();
  const first = event("CurveCompleted(bytes32)", { marketId: id("1") }, 2);
  assert.equal(applyV1Event(state, first), "applied");
  assert.equal(applyV1Event(state, first), "duplicate");
  assert.throws(() => applyV1Event(state, event("CurveCompleted(bytes32)", { marketId: id("2") }, 1)), /out-of-order/);
  assert.throws(() => applyV1Event(state, event("CurveCompleted(bytes32)", { marketId: id("1") }, 2, {
    blockHash: id("different"),
  })), /conflicting V1 log identity/);
  assert.throws(() => applyV1Event(state, event("CurveCompleted(bytes32)", { marketId: id("different") }, 2)), /conflicting V1 log identity/);
});

test("stores block-tagged chain observations instead of inventing missing balances", () => {
  const state = createIndexerState();
  applyV1Event(state, event("PendingScheduled(address,bytes32,uint256,uint64,uint64)", {
    user: address("a"), marketId: id("2"), amount: 12n, generation: 3n, unlockAt: 40n,
  }, 0, { observations: [{
    kind: "gaugePosition", key: `${address("a")}:${id("2")}`,
    value: { pendingStock: 12n, activeStock: 0n, claimableQuote: 0n, claimableMeme: 0n },
  }] }));
  const observed = state.gaugePositions.get(`${address("a")}:${id("2")}`);
  assert.equal(observed?.values.pendingStock, 12n);
  assert.equal(observed?.provenance.blockNumber, 10n);
});

test("plans block-tagged hydration where events intentionally contain only hashes or partial state", () => {
  const quote = event("QuoteAssetConfigAdded(bytes32,address,bytes32,bytes32)", {
    configId: id("1"), quoteAsset: address("2"), ponsBaselineId: id("3"), economicsHash: id("4"),
  }, 0);
  const pool = event("ExpectedPoolRegistered(bytes32,bytes32,bytes32,uint32)", {
    marketId: id("5"), poolId: id("6"), keyHash: id("7"), sourceVersion: 1n,
  }, 1);
  const minimum = event("AssetMinimumAllocationChanged(bytes32,uint256,uint256,bytes32)", {
    assetUid: id("8"), oldMinimum: 414n, newMinimum: 10_000n, reasonHash: id("9"),
  }, 2);
  const deposit = event("StockDeposited(bytes32,address,uint256)", {
    assetUid: id("8"), user: address("a"), amount: 10n,
  }, 3);
  assert.deepEqual(requiredObservations(quote).map(({ kind }) => kind), ["quote"]);
  assert.deepEqual(requiredObservations(pool).map(({ kind }) => kind), ["poolKey", "market"]);
  assert.deepEqual(requiredObservations(minimum).map(({ kind }) => kind), ["asset"]);
  assert.deepEqual(requiredObservations(deposit).map(({ kind }) => kind), ["vaultPosition", "vaultSolvency", "assetIdentity"]);
});

test("keys shared-Vault allocation facts by asset UID and plans both Vault and Gauge hydration", () => {
  const state = createIndexerState();
  const assetUid = id("11");
  const user = address("a");
  const marketId = id("22");
  const locked = event("AllocationLocked(bytes32,address,bytes32,uint256,uint256,uint256)", {
    assetUid, user, marketId, amount: 7n, userMarketAllocation: 7n, userTotalAllocated: 7n,
  }, 0);

  applyV1Event(state, locked);

  assert.equal(state.allocations.get(`${assetUid}:${user}:${marketId}`)?.values.userMarketAllocation, 7n);
  assert.deepEqual(requiredObservations(locked).map(({ kind }) => kind), ["vaultPosition", "gaugePosition", "assetIdentity"]);
});

test("projects the principal-first rage-quit tombstone and clears it only on Vault completion", () => {
  const state = createIndexerState();
  const assetUid = id("31");
  const user = address("a");
  const marketId = id("32");
  const principal = 500n;

  applyV1Event(state, event("RageQuitRewardSettlementQueued(bytes32,address,bytes32,uint256)", {
    assetUid, user, marketId, principal,
  }, 0));
  const allocationKey = `${assetUid}:${user}:${marketId}`;
  const gaugeKey = `${user}:${marketId}`;
  assert.equal(state.allocations.get(allocationKey)?.values.rageQuitSettlementPending, true);
  assert.equal(state.allocations.get(allocationKey)?.values.rageQuitSettlementPrincipal, principal);
  assert.equal(state.gaugePositions.get(gaugeKey)?.values.rageQuitSettlementStatus, "queued");
  assert.deepEqual(requiredObservations(event("RageQuitRewardSettlementQueued(bytes32,address,bytes32,uint256)", {
    assetUid, user, marketId, principal,
  }, 99)).map(({ kind }) => kind), ["vaultPosition", "gaugePosition", "assetIdentity"]);

  applyV1Event(state, event("RageQuitRewardSettlementDeferred(address,bytes32,uint256,address)", {
    user, marketId, principal, gauge: address("6"),
  }, 1));
  assert.equal(state.allocations.get(allocationKey)?.values.rageQuitSettlementStatus, "deferred");
  assert.equal(state.gaugePositions.get(gaugeKey)?.values.rageQuitSettlementPending, true);
  assert.equal(state.gaugePositions.get(gaugeKey)?.values.rageQuitSettlementGauge, address("6"));

  applyV1Event(state, event("RageQuitRewardSettlementCompleted(bytes32,address,bytes32,uint256)", {
    assetUid, user, marketId, principal,
  }, 2));
  assert.equal(state.allocations.get(allocationKey)?.values.rageQuitSettlementPending, false);
  assert.equal(state.allocations.get(allocationKey)?.values.rageQuitSettlementPrincipal, 0n);
  assert.equal(state.allocations.get(allocationKey)?.values.rageQuitSettlementCompletedPrincipal, principal);
  assert.equal(state.gaugePositions.get(gaugeKey)?.values.rageQuitSettlementPending, false);

  applyV1Event(state, event("RageQuitRewardSettlementFinalized(address,bytes32,uint256,uint256,uint256,bool)", {
    user, marketId, principal, quoteForfeited: 11n, memeForfeited: 7n, redistributed: true,
  }, 3));
  const finalized = state.gaugePositions.get(gaugeKey);
  assert.equal(finalized?.values.rageQuitSettlementStatus, "finalized");
  assert.equal(finalized?.values.rageQuitQuoteForfeited, 11n);
  assert.equal(finalized?.values.rageQuitMemeForfeited, 7n);
  assert.equal(finalized?.values.rageQuitRewardsRedistributed, true);
  assert.equal(finalized?.provenance.logIndex, 3);
});

test("does not fabricate an asset-scoped tombstone when replay starts with a Manager settlement event", () => {
  const state = createIndexerState();
  const user = address("b");
  const marketId = id("42");

  applyV1Event(state, event("RageQuitRewardSettlementDeferred(address,bytes32,uint256,address)", {
    user, marketId, principal: 9n, gauge: address("9"),
  }, 0));
  assert.equal(state.allocations.size, 0);
  assert.equal(state.gaugePositions.get(`${user}:${marketId}`)?.values.rageQuitSettlementPending, true);
  assert.equal(state.gaugePositions.get(`${user}:${marketId}`)?.values.rageQuitSettlementPrincipal, 9n);
});

test("projects deferred platform-reserve accounting and its permissionless flush", () => {
  const state = createIndexerState();
  const user = address("c");
  const marketId = id("43");

  applyV1Event(state, event("ForfeitureRecordDeferred(bytes32,address,uint256,uint256,uint256,uint256)", {
    marketId,
    user,
    quoteAmount: 11n,
    memeAmount: 7n,
    totalDeferredQuote: 11n,
    totalDeferredMeme: 7n,
  }, 0));
  assert.equal(state.gaugePositions.get(`${user}:${marketId}`)?.values.forfeitureReserveAccountingPending, true);
  assert.equal(state.markets.get(marketId)?.values.deferredForfeitureQuote, 11n);
  assert.equal(state.markets.get(marketId)?.values.deferredForfeitureMeme, 7n);

  applyV1Event(state, event("ForfeitureRecordFlushed(bytes32,uint256,uint256)", {
    marketId,
    quoteAmount: 11n,
    memeAmount: 7n,
  }, 1));
  assert.equal(state.markets.get(marketId)?.values.forfeitureReserveAccountingPending, false);
  assert.equal(state.markets.get(marketId)?.values.deferredForfeitureQuote, 0n);
  assert.equal(state.markets.get(marketId)?.values.lastFlushedForfeitureMeme, 7n);
});

test("attributes Curve trades through the canonical curve address, never symbol text", () => {
  const state = createIndexerState();
  const curve = address("5");
  applyV1Event(state, event("MarketRegistered(bytes32,bytes32,address,address,address,uint32)", {
    marketId: id("22"), assetUid: id("11"), memeToken: address("4"), curve, gauge: address("6"), sourceVersion: 1n,
  }, 0));
  applyV1Event(state, event("CurveBuy(address,address,uint256,uint256,uint256,uint256)", {
    buyer: address("a"), recipient: address("b"), quoteIn: 100n, tokensOut: 90n, fee: 5n, tax: 5n,
  }, 1, { emitter: curve }));
  assert.equal([...state.curveTrades.values()][0]?.values.marketId, id("22"));
});
