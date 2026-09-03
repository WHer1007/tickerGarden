import type { DecodedV2Event, ObservationRequest } from "./schema.ts";

export function requiredObservations(event: DecodedV2Event): readonly ObservationRequest[] {
  switch (event.signature) {
    case "QuoteAssetConfigAdded(bytes32,address,bytes32,bytes32)":
      return [{ kind: "quote", key: event.args.configId, reason: "event commits hashes but not the complete quote config" }];
    case "PonsBaselineAdded(bytes32,bytes32,bytes32)":
      return [{ kind: "pons", key: event.args.baselineId, reason: "event omits the complete approved baseline record" }];
    case "LaunchTemplateAdded(bytes32,bytes32,bytes32)":
      return [{ kind: "template", key: event.args.launchTemplateId, reason: "event commits templateHash but not template fields" }];
    case "MarketCreated(bytes32,bytes32,address,address,address,address,uint256,bytes32,bytes32,bytes32)":
    case "MarketRegistered(bytes32,bytes32,address,address,address,uint32)":
    case "LaunchPhaseChanged(bytes32,uint8,uint8,uint64,bytes32,uint32)":
      return [{ kind: "market", key: event.args.marketId, reason: "hydrate the canonical MarketView at this block" }];
    case "CurveBuy(address,address,uint256,uint256,uint256,uint256)":
    case "CurveSell(address,address,uint256,uint256,uint256,uint256)":
      return [{ kind: "curve", key: event.emitter, reason: "reserves and progress are authoritative contract views" }];
    case "CurveCompleted(bytes32)":
    case "LaunchSwept(bytes32,address,uint256,uint256,uint64)":
      return [{ kind: "curve", key: event.emitter, reason: "reserves and progress are authoritative contract views" }];
    case "ExpectedPoolRegistered(bytes32,bytes32,bytes32,uint32)":
    case "PoolBindingActivated(bytes32,bytes32,uint32)":
    case "PoolGraduated(bytes32,bytes32,address,uint256,uint256,uint256,uint256,uint32)":
      return [
        { kind: "poolKey", key: event.args.poolId, reason: "events carry keyHash, while readers require the full canonical PoolKey" },
        { kind: "market", key: event.args.marketId, reason: "hydrate canonical route and sourceVersion at this block" },
      ];
    case "PendingScheduled(address,bytes32,uint256,uint64,uint64)":
    case "PendingRescheduled(address,bytes32,uint64,uint64,uint256,uint64)":
    case "PendingMaterialized(address,bytes32,uint64,uint256)":
      return [{ kind: "gaugePosition", key: `${event.args.user}:${event.args.marketId}`, reason: "pending and active balances are authoritative Gauge views" }];
    case "StockDeposited(bytes32,address,uint256)":
    case "StockWithdrawn(bytes32,address,uint256)":
      return [{ kind: "vaultPosition", key: `${event.args.assetUid}:${event.args.user}`, reason: "deposited, allocated, and free balances are authoritative Vault views" }];
    case "AllocationLocked(address,bytes32,uint256,uint256,uint256)":
    case "AllocationReleased(address,bytes32,uint256,uint256,uint256)":
      return [{ kind: "gaugePosition", key: `${event.args.user}:${event.args.marketId}`, reason: "allocation changes must reconcile with the Gauge position" }];
    case "V4FeeAccrued(bytes32,bytes32,address,uint64,bytes32,uint256,uint256,uint256,uint256)":
      return [
        { kind: "market", key: event.args.marketId, reason: "verify the active sourceVersion for this Hook fee" },
        { kind: "liability", key: `${event.args.marketId}:${event.args.feeAsset}`, reason: "fee credit changes authoritative FeeVault liability" },
      ];
    case "FeeBucketsCredited(bytes32,uint32,address,bytes32,uint256,uint256,uint256,uint256,uint256)":
      return [{ kind: "liability", key: `${event.args.marketId}:${event.args.feeAsset}`, reason: "bucket credit changes authoritative FeeVault liability" }];
    case "CurveFeesSwept(bytes32,uint32,address,uint64,bytes32,uint256,uint256,uint256)":
      return [{ kind: "liability", key: `${event.args.marketId}:${event.args.quoteAsset}`, reason: "curve sweep changes authoritative FeeVault liability" }];
    case "FeeClaimed(uint8,address,bytes32,uint32,address,uint256)":
      return [{ kind: "liability", key: `${event.args.marketId}:${event.args.feeAsset}`, reason: "claims reduce authoritative FeeVault liability" }];
    case "RecoveryClaimed(bytes32,uint32,address,address,uint256)":
      return [{ kind: "liability", key: `${event.args.marketId}:${event.args.feeAsset}`, reason: "recovery claims reduce frozen-cap liability" }];
    default:
      return [];
  }
}
