import type { DecodedV1Event, ObservationRequest } from "./schema.ts";

export function requiredObservations(event: DecodedV1Event): readonly ObservationRequest[] {
  switch (event.signature) {
    case "QuoteAssetConfigAdded(bytes32,address,bytes32,bytes32)":
      return [{ kind: "quote", key: event.args.configId, reason: "event commits hashes but not the complete quote config" }];
    case "QuoteAssetIdentityPinned(bytes32,address,bytes32)":
      return [{ kind: "quote", key: event.args.configId, reason: "confirm the pinned runtime identity and live decimals at this block" }];
    case "PonsBaselineAdded(bytes32,bytes32,bytes32)":
      return [{ kind: "pons", key: event.args.baselineId, reason: "event omits the complete approved baseline record" }];
    case "LaunchTemplateAdded(bytes32,bytes32,bytes32)":
      return [{ kind: "template", key: event.args.launchTemplateId, reason: "event commits templateHash but not template fields" }];
    case "MarketCreated(bytes32,bytes32,address,address,address,address,bytes32,bytes32,bytes32)":
    case "MarketRegistered(bytes32,bytes32,address,address,address,uint32)":
    case "LaunchPhaseChanged(bytes32,uint8,uint8,bytes32,uint32)":
      return [{ kind: "market", key: event.args.marketId, reason: "hydrate the canonical MarketView at this block" }];
    case "CurveBuy(address,address,uint256,uint256,uint256,uint256)":
    case "CurveSell(address,address,uint256,uint256,uint256,uint256)":
      return [{ kind: "curve", key: event.emitter, reason: "reserves and progress are authoritative contract views" }];
    case "CurveCompleted(bytes32)":
      return [{ kind: "curve", key: event.emitter, reason: "reserves and progress are authoritative contract views" }];
    case "ExpectedPoolRegistered(bytes32,bytes32,bytes32,uint32)":
    case "PoolBindingActivated(bytes32,bytes32,uint32)":
    case "PoolGraduated(bytes32,bytes32,address,uint256,uint256,uint256,uint256,uint256,uint256,uint32)":
      return [
        { kind: "poolKey", key: event.args.poolId, reason: "events carry keyHash, while readers require the full canonical PoolKey" },
        { kind: "market", key: event.args.marketId, reason: "hydrate canonical route and sourceVersion at this block" },
      ];
    case "PendingScheduled(address,bytes32,uint256,uint64,uint64)":
    case "PendingRescheduled(address,bytes32,uint64,uint64,uint256,uint64)":
    case "PendingMaterialized(address,bytes32,uint64,uint256)":
      return [{ kind: "gaugePosition", key: `${event.args.user}:${event.args.marketId}`, reason: "pending and active balances are authoritative Gauge views" }];
    case "GaugeRageQuit(address,bytes32,uint256,uint256,uint256,bool)":
    case "AllocationRageQuitExecuted(address,bytes32,uint256,uint256,uint256,bool)":
    case "RageQuitRewardSettlementDeferred(address,bytes32,uint256,address)":
    case "RageQuitRewardSettlementFinalized(address,bytes32,uint256,uint256,uint256,bool)":
      return [{ kind: "gaugePosition", key: `${event.args.user}:${event.args.marketId}`, reason: "rage quit clears the authoritative Gauge position" }];
    case "StockDeposited(bytes32,address,uint256)":
    case "StockWithdrawn(bytes32,address,uint256)":
      return [
        { kind: "vaultPosition", key: `${event.args.assetUid}:${event.args.user}`, reason: "deposited, allocated, and free balances are authoritative Vault views" },
        { kind: "vaultSolvency", key: event.args.assetUid, reason: "the Vault token balance must cover totalDeposited for this asset" },
        { kind: "assetIdentity", key: event.args.assetUid, reason: "verify the canonical token proxy fingerprint against the asset config" },
      ];
    case "StockTokenFingerprintRegistered(bytes32,bytes32,address,bytes32,address,bytes32)":
    case "AssetImplementationAccepted(bytes32,address,address,bytes32,bytes32,bytes32)":
      return [{ kind: "assetIdentity", key: event.args.assetUid, reason: "asset implementation and runtime fingerprint are authoritative Registry identity" }];
    case "AssetMinimumAllocationChanged(bytes32,uint256,uint256,bytes32)":
      return [{ kind: "asset", key: event.args.assetUid, reason: "minimum allocation is an authoritative Registry policy value" }];
    case "AllocationLocked(bytes32,address,bytes32,uint256,uint256,uint256)":
    case "AllocationReleased(bytes32,address,bytes32,uint256,uint256,uint256)":
    case "AllocationRageQuit(bytes32,address,bytes32,uint256)":
    case "RageQuitRewardSettlementQueued(bytes32,address,bytes32,uint256)":
    case "RageQuitRewardSettlementCompleted(bytes32,address,bytes32,uint256)":
      return [
        { kind: "vaultPosition", key: `${event.args.assetUid}:${event.args.user}`, reason: "asset-scoped principal totals are authoritative Vault views" },
        { kind: "gaugePosition", key: `${event.args.user}:${event.args.marketId}`, reason: "allocation changes must reconcile with the Gauge position" },
        { kind: "assetIdentity", key: event.args.assetUid, reason: "allocation activity must detect token proxy implementation drift" },
      ];
    case "V4FeeAccrued(bytes32,bytes32,address,uint64,bytes32,uint256,uint256,uint256,uint256)":
      return [
        { kind: "market", key: event.args.marketId, reason: "verify the active sourceVersion for this Hook fee" },
        { kind: "liability", key: `${event.args.marketId}:${event.args.feeAsset}`, reason: "fee credit changes authoritative FeeVault liability" },
      ];
    case "FeeBucketsCredited(bytes32,uint32,address,bytes32,uint256,uint256,uint256,uint256)":
      return [{ kind: "liability", key: `${event.args.marketId}:${event.args.feeAsset}`, reason: "bucket credit changes authoritative FeeVault liability" }];
    case "ForfeitureReserved(bytes32,address,address,uint256,uint256)":
    case "ForfeitureReserveConverted(bytes32,address,uint256)":
      return [{ kind: "liability", key: `${event.args.marketId}:${event.args.feeAsset}`, reason: "forfeiture accounting changes authoritative Gauge and FeeVault state" }];
    case "CurveFeesSwept(bytes32,uint32,address,uint64,bytes32,uint256,uint256,uint256)":
      return [{ kind: "liability", key: `${event.args.marketId}:${event.args.quoteAsset}`, reason: "curve sweep changes authoritative FeeVault liability" }];
    case "FeeClaimed(uint8,address,bytes32,uint32,address,uint256)":
      return [{ kind: "liability", key: `${event.args.marketId}:${event.args.feeAsset}`, reason: "claims reduce authoritative FeeVault liability" }];
    default:
      return [];
  }
}
