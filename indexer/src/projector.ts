import { isDeepStrictEqual } from "node:util";
import type { DecodedV2Event, EventPosition, PositionProjection, Provenance, V2IndexerState } from "./schema.ts";
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

function mergeMarket(state: V2IndexerState, marketId: string, patch: object, at: Provenance): void {
  const current = state.markets.get(lower(marketId));
  state.markets.set(lower(marketId), {
    marketId: lower(marketId), values: { ...current?.values, ...patch }, provenance: at,
  });
}

function applyObservations(state: V2IndexerState, event: DecodedV2Event, at: Provenance): void {
  for (const observation of event.observations ?? []) {
    const observationKey = key(observation.kind, observation.key);
    put(state.observations, observationKey, observation.value, at);
    if (observation.kind === "market") mergeMarket(state, observation.key, observation.value, at);
    if (observation.kind === "poolKey") put(state.pools, lower(observation.key), observation.value, at);
    if (observation.kind === "vaultPosition") put(state.stockPositions, lower(observation.key), observation.value, at);
    if (observation.kind === "gaugePosition") put(state.gaugePositions, lower(observation.key), observation.value, at);
    if (observation.kind === "asset" || observation.kind === "quote" || observation.kind === "pons" || observation.kind === "template") {
      const configKey = key(observation.kind, observation.key);
      const current = state.configs.get(configKey);
      if (!current) throw new Error(`cannot hydrate unknown ${observation.kind} config ${observation.key}`);
      state.configs.set(configKey, { ...current, values: { ...current.values, ...observation.value }, provenance: at });
    }
  }
}

function marketIdForCurve(state: V2IndexerState, curve: string): string {
  const normalized = lower(curve);
  const match = [...state.markets.values()].find((market) =>
    typeof market.values.curve === "string" && lower(market.values.curve) === normalized,
  );
  if (!match) throw new Error(`unknown V2 Curve emitter ${curve}`);
  return match.marketId;
}

function assertFeeIdentity(state: V2IndexerState, feeId: string, marketId: string, feeAsset: string): void {
  const existing = state.feeCredits.get(lower(feeId));
  if (!existing) return;
  if (
    typeof existing.values.marketId === "string" && lower(existing.values.marketId) !== lower(marketId) ||
    typeof existing.values.feeAsset === "string" && lower(existing.values.feeAsset) !== lower(feeAsset) ||
    typeof existing.values.quoteAsset === "string" && lower(existing.values.quoteAsset) !== lower(feeAsset)
  ) throw new Error(`conflicting canonical feeId ${feeId}`);
}

export function applyV2Event(state: V2IndexerState, event: DecodedV2Event): "applied" | "duplicate" {
  const at = provenance(event);
  const existing = state.events.get(at.eventKey);
  if (existing) {
    if (
      lower(existing.provenance.blockHash) !== lower(event.blockHash) || existing.signature !== event.signature ||
      lower(existing.provenance.emitter) !== lower(event.emitter) || !isDeepStrictEqual(existing.args, event.args)
    ) {
      throw new Error(`conflicting V2 log identity ${at.eventKey}`);
    }
    return "duplicate";
  }
  if (state.lastPosition && comparePosition(state.lastPosition, event) >= 0) {
    throw new Error(`out-of-order V2 log ${at.eventKey}`);
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
  if (event.signature === "CurveFeesSwept(bytes32,uint32,address,uint64,bytes32,uint256,uint256,uint256)") {
    assertFeeIdentity(state, event.args.feeId, event.args.marketId, event.args.quoteAsset);
  }
  if (event.signature === "StakerFeeCredited(bytes32,address,bytes32,uint256,uint256,uint256)") {
    assertFeeIdentity(state, event.args.feeId, event.args.marketId, event.args.feeAsset);
  }
  if (event.signature === "RecoveryClaimed(bytes32,uint32,address,address,uint256)") {
    const claimKey = key(event.args.marketId, event.args.recoveryEpoch, event.args.feeAsset, event.args.user);
    if (state.recoveryClaims.has(claimKey)) throw new Error(`duplicate recovery claim ${claimKey}`);
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
    case "QuoteAssetConfigAdded(bytes32,address,bytes32,bytes32)":
      state.configs.set(key("quote", event.args.configId), { kind: "quote", id: lower(event.args.configId), status: 1n, values: values(event.args), provenance: at });
      break;
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
    case "LaunchPhaseChanged(bytes32,uint8,uint8,uint64,bytes32,uint32)":
      mergeMarket(state, event.args.marketId, { launchPhase: event.args.newPhase, sweptAt: event.args.sweptAt, poolId: event.args.poolId, sourceVersion: event.args.sourceVersion }, at); break;
    case "MarketStatusChanged(bytes32,uint8,uint8,uint64,uint64,bytes32)":
      mergeMarket(state, event.args.marketId, { marketStatus: event.args.newStatus, statusSince: event.args.statusSince, restrictedSince: event.args.restrictedSince, reasonHash: event.args.reasonHash }, at); break;
    case "MarketStatusChanged(bytes32,uint8,uint8,bytes32)":
      mergeMarket(state, event.args.marketId, { controllerStatus: event.args.newStatus, reasonHash: event.args.reasonHash }, at); break;
    case "EmergencyStateCommitted(bytes32,uint32,uint32,uint64,bytes32)":
    case "EmergencyExitActivated(bytes32,uint32,uint64,bytes32,uint256,uint256)":
      mergeMarket(state, event.args.marketId, event.args, at); break;
    case "CreatorRevenueEpochInitialized(bytes32,uint32,address)":
      mergeMarket(state, event.args.marketId, { creatorEpoch: event.args.epoch, creatorBeneficiary: event.args.beneficiary }, at); break;
    case "CreatorRevenueBeneficiaryUpdated(bytes32,uint32,uint32,address,address)":
      mergeMarket(state, event.args.marketId, { creatorEpoch: event.args.newEpoch, creatorBeneficiary: event.args.newBeneficiary }, at); break;
    case "CurveBuy(address,address,uint256,uint256,uint256,uint256)":
    case "CurveSell(address,address,uint256,uint256,uint256,uint256)":
    case "CurveBuyRefunded(address,uint256)":
      put(state.curveTrades, at.eventKey, { ...event.args, marketId: marketIdForCurve(state, event.emitter) }, at); break;
    case "CurveFeeTransferred(bytes32,uint64,bytes32,uint256)":
    case "LaunchSwept(bytes32,address,uint256,uint256,uint64)":
    case "AutoGraduationFailed(bytes32,bytes32)":
      put(state.curveTrades, at.eventKey, event.args, at); break;
    case "CurveCompleted(bytes32)":
      put(state.curveTrades, at.eventKey, event.args, at); mergeMarket(state, event.args.marketId, { curveCompleted: true }, at); break;
    case "ExpectedPoolRegistered(bytes32,bytes32,bytes32,uint32)":
    case "PoolBindingActivated(bytes32,bytes32,uint32)":
    case "PoolBindingDisabled(bytes32,bytes32,uint32)":
    case "PoolGraduated(bytes32,bytes32,address,uint256,uint256,uint256,uint256,uint32)":
      mergePosition(state.pools, lower(event.args.poolId), event.args, at);
      put(state.poolEvents, at.eventKey, event.args, at);
      mergeMarket(state, event.args.marketId, { poolId: event.args.poolId, poolEvent: event.signature }, at); break;
    case "Donate(bytes32,address,uint256,uint256)":
      put(state.poolEvents, at.eventKey, event.args, at); break;
    case "LaunchRescued(bytes32,uint64,uint64)":
      put(state.poolEvents, at.eventKey, event.args, at); mergeMarket(state, event.args.marketId, { rescuedAt: event.args.rescuedAt }, at); break;
    case "LockedFeesCompounded(bytes32,uint256,uint256,uint128,uint256,uint256)":
      put(state.poolEvents, at.eventKey, event.args, at); break;
    case "StockDeposited(bytes32,address,uint256)":
    case "StockWithdrawn(bytes32,address,uint256)":
      mergePosition(state.stockPositions, key(event.args.assetUid, event.args.user), { ...event.args, lastEvent: event.signature }, at); break;
    case "AllocationLocked(bytes32,address,bytes32,uint256,uint256,uint256)":
    case "AllocationReleased(bytes32,address,bytes32,uint256,uint256,uint256)":
    case "AllocationForceReleased(bytes32,address,bytes32,uint256,uint32)":
    case "AllocationRageQuit(bytes32,address,bytes32,uint256)":
      mergePosition(state.allocations, key(event.args.assetUid, event.args.user, event.args.marketId), { ...event.args, lastEvent: event.signature }, at); break;
    case "AllocationRageQuitExecuted(address,bytes32,uint256,uint256,uint256,bool)":
      mergePosition(state.gaugePositions, key(event.args.user, event.args.marketId), { ...event.args, lastEvent: event.signature }, at);
      break;
    case "AllocationMoved(bytes32,address,bytes32,bytes32,uint256)":
    case "AllocationMigrated(address,bytes32,bytes32,uint256,uint256,uint64,uint64)":
      put(state.allocations, at.eventKey, event.args, at); break;
    case "PendingScheduled(address,bytes32,uint256,uint64,uint64)":
    case "PendingRescheduled(address,bytes32,uint64,uint64,uint256,uint64)":
    case "PendingMaterialized(address,bytes32,uint64,uint256)":
      mergePosition(state.gaugePositions, key(event.args.user, event.args.marketId), { ...event.args, lastEvent: event.signature }, at); break;
    case "GaugeRageQuit(address,bytes32,uint256,uint256,uint256,bool)":
      mergePosition(state.gaugePositions, key(event.args.user, event.args.marketId), { ...event.args, lastEvent: event.signature }, at); break;
    case "ActivationBucketProcessed(bytes32,uint64,uint256,uint256,uint256,uint256)":
      put(state.activationBuckets, key(event.args.marketId, event.args.generation), event.args, at); break;
    case "StakerFeeCredited(bytes32,address,bytes32,uint256,uint256,uint256)":
    case "FeeBucketsCredited(bytes32,uint32,address,bytes32,uint256,uint256,uint256,uint256)":
    case "CurveFeesSwept(bytes32,uint32,address,uint64,bytes32,uint256,uint256,uint256)":
      mergePosition(state.feeCredits, lower(event.args.feeId), { ...event.args, lastEvent: event.signature }, at); break;
    case "ForfeitedRewardRedistributed(bytes32,address,address,uint256,uint256,uint256)":
      mergePosition(state.feeCredits, key("forfeiture-redistributed", event.args.marketId, event.args.feeAsset), { ...event.args, lastEvent: event.signature }, at); break;
    case "ForfeitureReserved(bytes32,address,address,uint256,uint256)":
      mergePosition(state.feeCredits, key("forfeiture-reserve", event.args.marketId, event.args.feeAsset), { ...event.args, lastEvent: event.signature }, at); break;
    case "ForfeitureReserveConverted(bytes32,address,uint256)":
      mergePosition(state.feeCredits, key("forfeiture-reserve", event.args.marketId, event.args.feeAsset), { ...event.args, lastEvent: event.signature, reserveBalance: 0n }, at); break;
    case "FeeClaimed(uint8,address,bytes32,uint32,address,uint256)":
      put(state.feeClaims, at.eventKey, event.args, at); break;
    case "RecoveryCapsFrozen(bytes32,uint32,uint64,bytes32,address,uint256,address,uint256)":
      put(state.recoveryCaps, key(event.args.marketId, event.args.recoveryEpoch), event.args, at); break;
    case "RecoveryRootProposed(bytes32,uint32,address,uint32,bytes32,uint256,uint64)":
    case "RecoveryRootCancelled(bytes32,uint32,address,uint32)":
    case "RecoveryRootFinalized(bytes32,uint32,address,uint32,bytes32,uint256)":
      mergePosition(state.recoveryRoots, key(event.args.marketId, event.args.recoveryEpoch, event.args.feeAsset, event.args.proposalNonce), { ...event.args, lifecycleEvent: event.signature }, at); break;
    case "RecoveryClaimed(bytes32,uint32,address,address,uint256)":
      put(state.recoveryClaims, key(event.args.marketId, event.args.recoveryEpoch, event.args.feeAsset, event.args.user), event.args, at); break;
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
