import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyV2Event,
  createIndexerState,
  getIndexerDescriptor,
  INDEXER_DESCRIPTOR,
  requiredObservations,
  V2_EVENT_ABI,
} from "../src/index.ts";
import type { DecodedV2Event } from "../src/index.ts";
import type { V2EventArgsBySignature, V2EventSignature } from "../src/generated/v2-events.ts";

const id = (value: string): `0x${string}` => `0x${value.padStart(64, "0")}`;
const address = (value: string): `0x${string}` => `0x${value.padStart(40, "0")}`;

function event<Signature extends V2EventSignature>(
  signature: Signature,
  args: V2EventArgsBySignature[Signature],
  logIndex: number,
  overrides: Partial<DecodedV2Event> = {},
): DecodedV2Event {
  return {
    chainId: 4663, blockNumber: 10n, blockHash: id("b"), transactionHash: id("a"),
    transactionIndex: 0, logIndex, emitter: address("1"), signature, args, ...overrides,
  } as DecodedV2Event;
}

test("exports the immutable V2 indexer descriptor", () => {
  assert.deepEqual(getIndexerDescriptor(), {
    chainId: 4663,
    executionSpecId: "V2-EXEC-3",
    status: "reorg-replay-and-reconciliation",
    handlersImplemented: true,
  });
  assert.equal(Object.isFrozen(INDEXER_DESCRIPTOR), true);
});

test("catalog is generated from V2 artifacts and includes the canonical PoolManager Swap", () => {
  assert.equal(V2_EVENT_ABI.length, 55);
  assert.ok(V2_EVENT_ABI.some(({ signature, modules }) =>
    signature === "MarketCreated(bytes32,bytes32,address,address,address,address,uint256,bytes32,bytes32,bytes32)" &&
    modules.includes("TickerGardenFactoryV2"),
  ));
  assert.ok(V2_EVENT_ABI.some(({ signature, modules }) =>
    signature === "Swap(bytes32,address,int128,int128,uint160,uint128,int24,uint24)" &&
    modules.includes("UniswapV4PoolManager"),
  ));
});

test("projects config and market facts with complete provenance and canonical IDs", () => {
  const state = createIndexerState();
  applyV2Event(state, event("AssetRegistered(bytes32,address,address,uint8)", {
    assetUid: id("11"), stockToken: address("2"), userStockVault: address("3"), tokenDecimals: 18n,
  }, 0));
  applyV2Event(state, event("MarketCreated(bytes32,bytes32,address,address,address,address,uint256,bytes32,bytes32,bytes32)", {
    marketId: id("22"), assetUid: id("11"), memeToken: address("4"), curve: address("5"), gauge: address("6"),
    quoteAsset: address("7"), stakeSaturationAmount: 100n, ponsBaselineId: id("8"), quoteAssetConfigId: id("9"),
    expectedEconomics: id("10"),
  }, 1));

  const config = state.configs.get(`asset:${id("11")}`);
  const market = state.markets.get(id("22"));
  assert.equal(config?.provenance.blockHash, id("b"));
  assert.equal(config?.provenance.transactionIndex, 0);
  assert.equal(market?.values.assetUid, id("11"));
  assert.equal(market?.provenance.logIndex, 1);
  assert.equal(state.events.size, 2);
});

test("correlates each PoolManager Swap only with its following Hook fee by transaction log order", () => {
  const state = createIndexerState();
  const poolId = id("44");
  applyV2Event(state, event("Swap(bytes32,address,int128,int128,uint160,uint128,int24,uint24)", {
    id: poolId, sender: address("a"), amount0: -10n, amount1: 9n, sqrtPriceX96: 1n, liquidity: 2n, tick: 3n, fee: 0n,
  }, 4));
  applyV2Event(state, event("FeeBucketsCredited(bytes32,uint32,address,bytes32,uint256,uint256,uint256,uint256,uint256)", {
    marketId: id("33"), creatorEpoch: 1n, feeAsset: address("7"), feeId: id("55"), creatorAmount: 2n,
    stakerAmount: 7n, platformAmount: 1n, activeStock: 50n, stakeSaturationAmount: 100n,
  }, 5));
  applyV2Event(state, event("V4FeeAccrued(bytes32,bytes32,address,uint64,bytes32,uint256,uint256,uint256,uint256)", {
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
  assert.throws(() => applyV2Event(state, event("V4FeeAccrued(bytes32,bytes32,address,uint64,bytes32,uint256,uint256,uint256,uint256)", {
    marketId: id("33"), poolId: id("44"), feeAsset: address("7"), feeNonce: 1n, feeId: id("55"), base: 1000n,
    totalFee: 10n, lpAmount: 2n, nonLpAmount: 8n,
  }, 1)), /no preceding unpaired Swap/);
  assert.equal(state.events.size, 0);
});

test("is idempotent for one log and rejects non-duplicate out-of-order input", () => {
  const state = createIndexerState();
  const first = event("CurveCompleted(bytes32)", { marketId: id("1") }, 2);
  assert.equal(applyV2Event(state, first), "applied");
  assert.equal(applyV2Event(state, first), "duplicate");
  assert.throws(() => applyV2Event(state, event("CurveCompleted(bytes32)", { marketId: id("2") }, 1)), /out-of-order/);
  assert.throws(() => applyV2Event(state, event("CurveCompleted(bytes32)", { marketId: id("1") }, 2, {
    blockHash: id("different"),
  })), /conflicting V2 log identity/);
  assert.throws(() => applyV2Event(state, event("CurveCompleted(bytes32)", { marketId: id("different") }, 2)), /conflicting V2 log identity/);
});

test("stores block-tagged chain observations instead of inventing missing balances", () => {
  const state = createIndexerState();
  applyV2Event(state, event("PendingScheduled(address,bytes32,uint256,uint64,uint64)", {
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
  assert.deepEqual(requiredObservations(quote).map(({ kind }) => kind), ["quote"]);
  assert.deepEqual(requiredObservations(pool).map(({ kind }) => kind), ["poolKey", "market"]);
});

test("attributes Curve trades through the canonical curve address, never symbol text", () => {
  const state = createIndexerState();
  const curve = address("5");
  applyV2Event(state, event("MarketRegistered(bytes32,bytes32,address,address,address,uint32)", {
    marketId: id("22"), assetUid: id("11"), memeToken: address("4"), curve, gauge: address("6"), sourceVersion: 1n,
  }, 0));
  applyV2Event(state, event("CurveBuy(address,address,uint256,uint256,uint256,uint256)", {
    buyer: address("a"), recipient: address("b"), quoteIn: 100n, tokensOut: 90n, fee: 5n, tax: 5n,
  }, 1, { emitter: curve }));
  assert.equal([...state.curveTrades.values()][0]?.values.marketId, id("22"));
});

test("projects activation, claims, and the complete recovery-root lifecycle without losing proposed data", () => {
  const state = createIndexerState();
  const marketId = id("20");
  const feeAsset = address("7");
  applyV2Event(state, event("ActivationBucketProcessed(bytes32,uint64,uint256,uint256,uint256,uint256)", {
    marketId, generation: 2n, amount: 50n, quoteAccumulator: 3n, memeAccumulator: 4n, refs: 2n,
  }, 0));
  applyV2Event(state, event("FeeClaimed(uint8,address,bytes32,uint32,address,uint256)", {
    beneficiaryType: 2n, beneficiary: address("a"), marketId, beneficiaryEpoch: 0n, feeAsset, amount: 9n,
  }, 1));
  applyV2Event(state, event("RecoveryCapsFrozen(bytes32,uint32,uint64,bytes32,address,uint256,address,uint256)", {
    marketId, recoveryEpoch: 1n, snapshotBlock: 9n, stateHash: id("21"), quoteAsset: feeAsset,
    quoteCap: 30n, memeAsset: address("8"), memeCap: 40n,
  }, 2));
  applyV2Event(state, event("RecoveryRootProposed(bytes32,uint32,address,uint32,bytes32,uint256,uint64)", {
    marketId, recoveryEpoch: 1n, feeAsset, proposalNonce: 1n, root: id("22"), declaredTotal: 20n, finalizableAt: 99n,
  }, 3));
  applyV2Event(state, event("RecoveryRootFinalized(bytes32,uint32,address,uint32,bytes32,uint256)", {
    marketId, recoveryEpoch: 1n, feeAsset, proposalNonce: 1n, root: id("22"), declaredTotal: 20n,
  }, 4));
  applyV2Event(state, event("RecoveryClaimed(bytes32,uint32,address,address,uint256)", {
    marketId, recoveryEpoch: 1n, feeAsset, user: address("a"), amount: 7n,
  }, 5));

  assert.equal(state.activationBuckets.get(`${marketId}:2`)?.values.refs, 2n);
  assert.equal(state.feeClaims.size, 1);
  assert.equal(state.recoveryCaps.get(`${marketId}:1`)?.values.quoteCap, 30n);
  const root = state.recoveryRoots.get(`${marketId}:1:${feeAsset}:1`);
  assert.equal(root?.values.finalizableAt, 99n);
  assert.equal(root?.values.lifecycleEvent, "RecoveryRootFinalized(bytes32,uint32,address,uint32,bytes32,uint256)");
  assert.equal(state.recoveryClaims.get(`${marketId}:1:${feeAsset}:${address("a")}`)?.values.amount, 7n);
  assert.throws(() => applyV2Event(state, event("RecoveryClaimed(bytes32,uint32,address,address,uint256)", {
    marketId, recoveryEpoch: 1n, feeAsset, user: address("a"), amount: 7n,
  }, 6)), /duplicate recovery claim/);
});
