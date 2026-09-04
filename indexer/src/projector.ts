import { isDeepStrictEqual } from "node:util";
import type { DecodedV1Event, EventPosition, PositionProjection, Provenance, V1IndexerState } from "./schema.ts";
import { eventKey } from "./schema.ts";

const lower = (value: string): string => value.toLowerCase();
const key = (...parts: readonly (string | bigint | number)[]): string => parts.map(String).join(":").toLowerCase();
const values = (args: object): Readonly<Record<string, unknown>> => ({ ...args });

function provenance(event: EventPosition): Provenance {
  return { ...event, eventKey: eventKey(event) };
}

function comparePosition(left: EventPosition, right: EventPosition): number {
  if (left.chainId !== right.chainId) throw new Error("cannot mix chain IDs in one projector state");
  if (left.blockNumber !== right.blockNumber) return left.blockNumber < right.blockNumber ? -1 : 1;
  if (left.transactionIndex !== right.transactionIndex) return left.transactionIndex - right.transactionIndex;
  return left.logIndex - right.logIndex;
}

function put(map: Map<string, PositionProjection>, projectionKey: string, args: object, at: Provenance): void {
  map.set(projectionKey, { key: projectionKey, values: values(args), provenance: at });
}

function mergePosition(map: Map<string, PositionProjection>, projectionKey: string, patch: object, at: Provenance): void {
  const current = map.get(projectionKey);
  map.set(projectionKey, { key: projectionKey, values: { ...current?.values, ...patch }, provenance: at });
}

function mergeMarket(state: V1IndexerState, marketId: string, patch: object, at: Provenance): void {
  const current = state.markets.get(lower(marketId));
  state.markets.set(lower(marketId), {
    marketId: lower(marketId), values: { ...current?.values, ...patch }, provenance: at,
  });
}

function allocationKey(assetUid: string, user: string, marketId: string): string {
  return key(assetUid, user, marketId);
}

function gaugeKey(user: string, marketId: string): string {
  return key(user, marketId);
}

/**
 * Settlement events are emitted by both the Vault and the AllocationManager.
 * The Vault event is the only event that carries assetUid, so Manager events
 * enrich the already-known allocation tombstone when it is present, while
 * still being projected into the user/market Gauge view when replay starts
 * from a Manager event.
 */
function mergeRageQuitAllocationByMarket(
  state: V1IndexerState,
  user: string,
  marketId: string,
  patch: object,
  at: Provenance,
): void {
  // Do not invent an asset-scoped tombstone from a Manager event: the asset
  // binding is authoritative only when supplied by the Vault event. The
  // queued Vault projection stores it in the user/market Gauge projection,
  // allowing every later update to remain O(1).
  const gauge = state.gaugePositions.get(gaugeKey(user, marketId));
  const assetUid = gauge?.values.assetUid;
  if (typeof assetUid === "string") {
    mergePosition(state.allocations, allocationKey(assetUid, user, marketId), patch, at);
  }
}

function applyObservations(state: V1IndexerState, event: DecodedV1Event, at: Provenance): void {
  for (const observation of event.observations ?? []) {
    const observationKey = key(observation.kind, observation.key);
    put(state.observations, observationKey, observation.value, at);
    if (observation.kind === "market") mergeMarket(state, observation.key, observation.value, at);
    if (observation.kind === "poolKey") put(state.pools, lower(observation.key), observation.value, at);
    if (observation.kind === "vaultPosition") put(state.stockPositions, lower(observation.key), observation.value, at);
    if (observation.kind === "gaugePosition") put(state.gaugePositions, lower(observation.key), observation.value, at);
    if (observation.kind === "asset" || observation.kind === "assetIdentity" || observation.kind === "quote" || observation.kind === "pons" || observation.kind === "template") {
      const configKey = key(observation.kind, observation.key);
      const actualConfigKey = observation.kind === "assetIdentity" ? key("asset", observation.key) : configKey;
      const current = state.configs.get(actualConfigKey);
      if (!current) throw new Error(`cannot hydrate unknown ${observation.kind} config ${observation.key}`);
      state.configs.set(actualConfigKey, { ...current, values: { ...current.values, ...observation.value }, provenance: at });
    }
  }
}

function marketIdForCurve(state: V1IndexerState, curve: string): string {
  const normalized = lower(curve);
  const match = [...state.markets.values()].find((market) =>
    typeof market.values.curve === "string" && lower(market.values.curve) === normalized,
  );
  if (!match) throw new Error(`unknown V1 Curve emitter ${curve}`);
  return match.marketId;
}

function assertFeeIdentity(state: V1IndexerState, feeId: string, marketId: string, feeAsset: string): void {
  const existing = state.feeCredits.get(lower(feeId));
  if (!existing) return;
  if (
    typeof existing.values.marketId === "string" && lower(existing.values.marketId) !== lower(marketId) ||
    typeof existing.values.feeAsset === "string" && lower(existing.values.feeAsset) !== lower(feeAsset) ||
    typeof existing.values.quoteAsset === "string" && lower(existing.values.quoteAsset) !== lower(feeAsset)
  ) throw new Error(`conflicting canonical feeId ${feeId}`);
}

export function applyV1Event(state: V1IndexerState, event: DecodedV1Event): "applied" | "duplicate" {
  const at = provenance(event);
  const existing = state.events.get(at.eventKey);
  if (existing) {
    if (
      lower(existing.provenance.blockHash) !== lower(event.blockHash) || existing.signature !== event.signature ||
      lower(existing.provenance.emitter) !== lower(event.emitter) || !isDeepStrictEqual(existing.args, event.args)
    ) {
      throw new Error(`conflicting V1 log identity ${at.eventKey}`);
    }
    return "duplicate";
  }
  if (state.lastPosition && comparePosition(state.lastPosition, event) >= 0) {
    throw new Error(`out-of-order V1 log ${at.eventKey}`);
  }
  if (event.signature === "V4FeeAccrued(bytes32,bytes32,address,uint64,bytes32,uint256,uint256,uint256,uint256)") {
    assertFeeIdentity(state, event.args.feeId, event.args.marketId, event.args.feeAsset);
    const nonceConflict = [...state.feeCredits.entries()].some(([feeId, credit]) =>
      feeId !== lower(event.args.feeId) && credit.values.feeNonce === event.args.feeNonce &&
      typeof credit.values.marketId === "string" && lower(credit.values.marketId) === lower(event.args.marketId) &&
      typeof credit.values.poolId === "string" && lower(credit.values.poolId) === lower(event.args.poolId),
    );
    if (nonceConflict) throw new Error(`conflicting V4 fee nonce ${event.args.feeNonce}`);
    const hasSwap = [...state.swaps.values()].some((swap) =>
      swap.poolId === lower(event.args.poolId) && lower(swap.provenance.transactionHash) === lower(event.transactionHash) &&
      swap.provenance.logIndex < event.logIndex && swap.hookFeeEventKey === undefined,
    );
    if (!hasSwap) throw new Error(`V4FeeAccrued has no preceding unpaired Swap in transaction ${event.transactionHash}`);
  }
  if (event.signature === "FeeBucketsCredited(bytes32,uint32,address,bytes32,uint256,uint256,uint256,uint256)") {
    assertFeeIdentity(state, event.args.feeId, event.args.marketId, event.args.feeAsset);
  }
  if (
    (
      event.signature === "AllocationRageQuitExecuted(address,bytes32,uint256,uint256,uint256,bool)" ||
      event.signature === "RageQuitRewardSettlementFinalized(address,bytes32,uint256,uint256,uint256,bool)" ||
      event.signature === "GaugeRageQuit(address,bytes32,uint256,uint256,uint256,bool)"
    ) && event.args.redistributed
  ) {
    throw new Error(`${event.signature} redistributed=true violates the platform forfeiture policy`);
  }
  if (event.signature === "CurveFeesSwept(bytes32,uint32,address,uint64,bytes32,uint256,uint256,uint256)") {
    assertFeeIdentity(state, event.args.feeId, event.args.marketId, event.args.quoteAsset);
  }
  if (event.signature === "StakerFeeCredited(bytes32,address,bytes32,uint256,uint256,uint256)") {
    assertFeeIdentity(state, event.args.feeId, event.args.marketId, event.args.feeAsset);
  }
  if (event.signature === "QuoteAssetIdentityPinned(bytes32,address,bytes32)") {
    const old = state.configs.get(key("quote", event.args.configId));
    if (!old) throw new Error(`cannot pin unknown quote config ${event.args.configId}`);
    if (
      typeof old.values.quoteAsset !== "string"
        || lower(old.values.quoteAsset) !== lower(event.args.quoteAsset)
    ) {
      throw new Error(`quote identity asset mismatch for ${event.args.configId}`);
    }
  }
  if (
    event.signature === "CurveBuy(address,address,uint256,uint256,uint256,uint256)" ||
    event.signature === "CurveSell(address,address,uint256,uint256,uint256,uint256)" ||
    event.signature === "CurveBuyRefunded(address,uint256)"
  ) {
    marketIdForCurve(state, event.emitter);
  }
  state.events.set(at.eventKey, { provenance: at, signature: event.signature, args: event.args });

  switch (event.signature) {
    case "AssetRegistered(bytes32,address,address,uint8)":
      state.configs.set(key("asset", event.args.assetUid), { kind: "asset", id: lower(event.args.assetUid), status: 1n, values: values(event.args), provenance: at });
      break;
    case "AssetStatusChanged(bytes32,uint8,uint8,bytes32)": {
      const k = key("asset", event.args.assetUid); const old = state.configs.get(k);
      state.configs.set(k, { kind: "asset", id: lower(event.args.assetUid), status: event.args.newStatus, values: { ...old?.values, reasonHash: event.args.reasonHash }, provenance: at });
      break;
    }
    case "AssetMinimumAllocationChanged(bytes32,uint256,uint256,bytes32)": {
      const k = key("asset", event.args.assetUid); const old = state.configs.get(k);
      state.configs.set(k, { kind: "asset", id: lower(event.args.assetUid), status: old?.status ?? 1n,
        values: { ...old?.values, minimumAllocation: event.args.newMinimum, minimumAllocationReasonHash: event.args.reasonHash }, provenance: at });
      break;
    }
    case "StockTokenFingerprintRegistered(bytes32,bytes32,address,bytes32,address,bytes32)":
      mergePosition(state.observations, key("assetIdentity", event.args.assetUid), event.args, at);
      {
        const k = key("asset", event.args.assetUid); const old = state.configs.get(k);
        state.configs.set(k, { kind: "asset", id: lower(event.args.assetUid), status: old?.status ?? 1n,
          values: { ...old?.values, ...event.args }, provenance: at });
      }
      break;
    case "AssetImplementationAccepted(bytes32,address,address,bytes32,bytes32,bytes32)":
      mergePosition(state.observations, key("assetIdentity", event.args.assetUid), event.args, at);
      {
        const k = key("asset", event.args.assetUid); const old = state.configs.get(k);
        state.configs.set(k, { kind: "asset", id: lower(event.args.assetUid), status: old?.status ?? 1n,
          values: {
            ...old?.values,
            ...event.args,
            implementation: event.args.newImplementation,
            implementationRuntimeCodeHash: event.args.newImplementationRuntimeCodeHash,
          }, provenance: at });
      }
      break;
    case "QuoteAssetConfigAdded(bytes32,address,bytes32,bytes32)":
      state.configs.set(key("quote", event.args.configId), { kind: "quote", id: lower(event.args.configId), status: 1n, values: values(event.args), provenance: at });
      break;
    case "QuoteAssetIdentityPinned(bytes32,address,bytes32)": {
      const k = key("quote", event.args.configId); const old = state.configs.get(k)!;
      state.configs.set(k, {
        ...old,
        values: { ...old.values, quoteAsset: event.args.quoteAsset, runtimeCodeHash: event.args.runtimeCodeHash },
        provenance: at,
      });
      break;
    }
    case "QuoteAssetStatusChanged(bytes32,uint8,uint8,bytes32)": {
      const k = key("quote", event.args.configId); const old = state.configs.get(k);
      state.configs.set(k, { kind: "quote", id: lower(event.args.configId), status: event.args.newStatus, values: { ...old?.values, reasonHash: event.args.reasonHash }, provenance: at });
      break;
    }
    case "PonsBaselineAdded(bytes32,bytes32,bytes32)":
      state.configs.set(key("pons", event.args.baselineId), { kind: "pons", id: lower(event.args.baselineId), status: 1n, values: values(event.args), provenance: at });
      break;
    case "PonsBaselineStatusChanged(bytes32,uint8,uint8,bytes32)": {
      const k = key("pons", event.args.baselineId); const old = state.configs.get(k);
      state.configs.set(k, { kind: "pons", id: lower(event.args.baselineId), status: event.args.newStatus, values: { ...old?.values, reasonHash: event.args.reasonHash }, provenance: at });
      break;
    }
    case "LaunchTemplateAdded(bytes32,bytes32,bytes32)":
      state.configs.set(key("template", event.args.launchTemplateId), { kind: "template", id: lower(event.args.launchTemplateId), status: 1n, values: values(event.args), provenance: at });
      break;
    case "LaunchTemplateStatusChanged(bytes32,uint8,uint8,bytes32)": {
      const k = key("template", event.args.launchTemplateId); const old = state.configs.get(k);
      state.configs.set(k, { kind: "template", id: lower(event.args.launchTemplateId), status: event.args.newStatus, values: { ...old?.values, reasonHash: event.args.reasonHash }, provenance: at });
      break;
    }
    case "MarketCreated(bytes32,bytes32,address,address,address,address,bytes32,bytes32,bytes32)":
    case "MarketRegistered(bytes32,bytes32,address,address,address,uint32)":
      mergeMarket(state, event.args.marketId, event.args, at); break;
    case "LaunchPhaseChanged(bytes32,uint8,uint8,bytes32,uint32)":
      mergeMarket(state, event.args.marketId, { launchPhase: event.args.newPhase, poolId: event.args.poolId, sourceVersion: event.args.sourceVersion }, at); break;
    case "CreatorRevenueEpochInitialized(bytes32,uint32,address)":
      mergeMarket(state, event.args.marketId, { creatorEpoch: event.args.epoch, creatorBeneficiary: event.args.beneficiary }, at); break;
    case "CreatorRevenueBeneficiaryUpdated(bytes32,uint32,uint32,address,address)":
      mergeMarket(state, event.args.marketId, { creatorEpoch: event.args.newEpoch, creatorBeneficiary: event.args.newBeneficiary }, at); break;
    case "CurveBuy(address,address,uint256,uint256,uint256,uint256)":
    case "CurveSell(address,address,uint256,uint256,uint256,uint256)":
    case "CurveBuyRefunded(address,uint256)":
      put(state.curveTrades, at.eventKey, { ...event.args, marketId: marketIdForCurve(state, event.emitter) }, at); break;
    case "CurveFeeTransferred(bytes32,uint64,bytes32,uint256)":
      put(state.curveTrades, at.eventKey, event.args, at); break;
    case "CurveCompleted(bytes32)":
      put(state.curveTrades, at.eventKey, event.args, at); mergeMarket(state, event.args.marketId, { curveCompleted: true }, at); break;
    case "ExpectedPoolRegistered(bytes32,bytes32,bytes32,uint32)":
    case "PoolBindingActivated(bytes32,bytes32,uint32)":
    case "PoolGraduated(bytes32,bytes32,address,uint256,uint256,uint256,uint256,uint32)":
      mergePosition(state.pools, lower(event.args.poolId), event.args, at);
      put(state.poolEvents, at.eventKey, event.args, at);
      mergeMarket(state, event.args.marketId, { poolId: event.args.poolId, poolEvent: event.signature }, at); break;
    case "Donate(bytes32,address,uint256,uint256)":
      put(state.poolEvents, at.eventKey, event.args, at); break;
    case "StockDeposited(bytes32,address,uint256)":
    case "StockWithdrawn(bytes32,address,uint256)":
      mergePosition(state.stockPositions, key(event.args.assetUid, event.args.user), { ...event.args, lastEvent: event.signature }, at); break;
    case "AllocationLocked(bytes32,address,bytes32,uint256,uint256,uint256)":
    case "AllocationReleased(bytes32,address,bytes32,uint256,uint256,uint256)":
    case "AllocationRageQuit(bytes32,address,bytes32,uint256)":
      mergePosition(state.allocations, key(event.args.assetUid, event.args.user, event.args.marketId), { ...event.args, lastEvent: event.signature }, at); break;
    case "AllocationRageQuitExecuted(address,bytes32,uint256,uint256,uint256,bool)":
      mergePosition(state.gaugePositions, key(event.args.user, event.args.marketId), {
        ...event.args,
        redistributed: false,
        forfeitureDestination: "platform_forfeiture_reserve",
        lastEvent: event.signature,
      }, at);
      break;
    case "RageQuitRewardSettlementQueued(bytes32,address,bytes32,uint256)": {
      const projectionKey = allocationKey(event.args.assetUid, event.args.user, event.args.marketId);
      mergePosition(state.allocations, projectionKey, {
        ...event.args,
        rageQuitSettlementPending: true,
        rageQuitSettlementPrincipal: event.args.principal,
        rageQuitSettlementStatus: "queued",
        lastEvent: event.signature,
      }, at);
      mergePosition(state.gaugePositions, gaugeKey(event.args.user, event.args.marketId), {
        ...event.args,
        rageQuitSettlementPending: true,
        rageQuitSettlementPrincipal: event.args.principal,
        rageQuitSettlementStatus: "queued",
        lastEvent: event.signature,
      }, at);
      break;
    }
    case "RageQuitRewardSettlementCompleted(bytes32,address,bytes32,uint256)": {
      const patch = {
        ...event.args,
        rageQuitSettlementPending: false,
        rageQuitSettlementPrincipal: 0n,
        rageQuitSettlementCompletedPrincipal: event.args.principal,
        rageQuitSettlementStatus: "completed",
        lastEvent: event.signature,
      };
      mergePosition(state.allocations, allocationKey(event.args.assetUid, event.args.user, event.args.marketId), patch, at);
      mergePosition(state.gaugePositions, gaugeKey(event.args.user, event.args.marketId), patch, at);
      break;
    }
    case "RageQuitRewardSettlementDeferred(address,bytes32,uint256,address)": {
      const patch = {
        ...event.args,
        rageQuitSettlementPending: true,
        rageQuitSettlementPrincipal: event.args.principal,
        rageQuitSettlementGauge: event.args.gauge,
        rageQuitSettlementStatus: "deferred",
        lastEvent: event.signature,
      };
      mergePosition(state.gaugePositions, gaugeKey(event.args.user, event.args.marketId), patch, at);
      mergeRageQuitAllocationByMarket(state, event.args.user, event.args.marketId, patch, at);
      break;
    }
    case "RageQuitRewardSettlementFinalized(address,bytes32,uint256,uint256,uint256,bool)": {
      const patch = {
        ...event.args,
        rageQuitSettlementPending: false,
        rageQuitSettlementPrincipal: 0n,
        rageQuitSettlementCompletedPrincipal: event.args.principal,
        rageQuitSettlementStatus: "finalized",
        rageQuitQuoteForfeited: event.args.quoteForfeited,
        rageQuitMemeForfeited: event.args.memeForfeited,
        rageQuitRewardsRedistributed: false,
        rageQuitForfeitureDestination: "platform_forfeiture_reserve",
        lastEvent: event.signature,
      };
      mergePosition(state.gaugePositions, gaugeKey(event.args.user, event.args.marketId), patch, at);
      mergeRageQuitAllocationByMarket(state, event.args.user, event.args.marketId, patch, at);
      break;
    }
    case "PendingScheduled(address,bytes32,uint256,uint64,uint64)":
    case "PendingRescheduled(address,bytes32,uint64,uint64,uint256,uint64)":
    case "PendingMaterialized(address,bytes32,uint64,uint256)":
      mergePosition(state.gaugePositions, key(event.args.user, event.args.marketId), { ...event.args, lastEvent: event.signature }, at); break;
    case "GaugeRageQuit(address,bytes32,uint256,uint256,uint256,bool)":
      mergePosition(state.gaugePositions, key(event.args.user, event.args.marketId), {
        ...event.args,
        redistributed: false,
        forfeitureDestination: "platform_forfeiture_reserve",
        lastEvent: event.signature,
      }, at); break;
    case "ForfeitureRecordDeferred(bytes32,address,uint256,uint256,uint256,uint256)":
      mergePosition(state.gaugePositions, gaugeKey(event.args.user, event.args.marketId), {
        ...event.args,
        forfeitureReserveAccountingPending: true,
        lastEvent: event.signature,
      }, at);
      mergeMarket(state, event.args.marketId, {
        deferredForfeitureQuote: event.args.totalDeferredQuote,
        deferredForfeitureMeme: event.args.totalDeferredMeme,
        forfeitureReserveAccountingPending: true,
      }, at);
      break;
    case "ForfeitureRecordFlushed(bytes32,uint256,uint256)":
      mergeMarket(state, event.args.marketId, {
        deferredForfeitureQuote: 0n,
        deferredForfeitureMeme: 0n,
        lastFlushedForfeitureQuote: event.args.quoteAmount,
        lastFlushedForfeitureMeme: event.args.memeAmount,
        forfeitureReserveAccountingPending: false,
      }, at);
      break;
    case "ActivationBucketProcessed(bytes32,uint64,uint256,uint256,uint256,uint256)":
      put(state.activationBuckets, key(event.args.marketId, event.args.generation), event.args, at); break;
    case "StakerFeeCredited(bytes32,address,bytes32,uint256,uint256,uint256)":
    case "FeeBucketsCredited(bytes32,uint32,address,bytes32,uint256,uint256,uint256,uint256)":
    case "CurveFeesSwept(bytes32,uint32,address,uint64,bytes32,uint256,uint256,uint256)":
      mergePosition(state.feeCredits, lower(event.args.feeId), { ...event.args, lastEvent: event.signature }, at); break;
    case "ForfeitureReserved(bytes32,address,address,uint256,uint256)":
      mergePosition(state.feeCredits, key("forfeiture-reserve", event.args.marketId, event.args.feeAsset), { ...event.args, lastEvent: event.signature }, at); break;
    case "ForfeitureReserveConverted(bytes32,address,uint256)":
      mergePosition(state.feeCredits, key("forfeiture-reserve", event.args.marketId, event.args.feeAsset), { ...event.args, lastEvent: event.signature, reserveBalance: 0n }, at); break;
    case "FeeClaimed(uint8,address,bytes32,uint32,address,uint256)":
      put(state.feeClaims, at.eventKey, event.args, at); break;
    case "Swap(bytes32,address,int128,int128,uint160,uint128,int24,uint24)":
      state.swaps.set(at.eventKey, { eventKey: at.eventKey, poolId: lower(event.args.id), values: values(event.args), provenance: at }); break;
    case "V4FeeAccrued(bytes32,bytes32,address,uint64,bytes32,uint256,uint256,uint256,uint256)": {
      mergePosition(state.feeCredits, lower(event.args.feeId), { ...event.args, lastEvent: event.signature }, at);
      const candidates = [...state.swaps.values()].filter((swap) =>
        swap.poolId === lower(event.args.poolId) && lower(swap.provenance.transactionHash) === lower(event.transactionHash) &&
        swap.provenance.logIndex < event.logIndex && swap.hookFeeEventKey === undefined,
      ).sort((x, y) => y.provenance.logIndex - x.provenance.logIndex);
      const swap = candidates[0];
      if (!swap) throw new Error(`V4FeeAccrued has no preceding unpaired Swap in transaction ${event.transactionHash}`);
      state.swaps.set(swap.eventKey, { ...swap, hookFeeEventKey: at.eventKey, feeId: lower(event.args.feeId) });
      break;
    }
    default:
      break;
  }

  applyObservations(state, event, at);
  state.lastPosition = at;
  return "applied";
}
