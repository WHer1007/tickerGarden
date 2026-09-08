import type { V1EventArgsBySignature, V1EventSignature } from "./generated/v1-events.ts";

export interface EventPosition {
  readonly chainId: number;
  readonly blockNumber: bigint;
  readonly blockHash: string;
  readonly transactionHash: string;
  readonly transactionIndex: number;
  readonly logIndex: number;
  readonly emitter: string;
}

export type DecodedV1Event = {
  readonly [Signature in V1EventSignature]: EventPosition & {
    readonly signature: Signature;
    readonly args: V1EventArgsBySignature[Signature];
    readonly observations?: readonly ChainObservation[];
  };
}[V1EventSignature];

export interface Provenance extends EventPosition {
  readonly eventKey: string;
}

export interface ChainObservation {
  readonly kind: "asset" | "assetIdentity" | "quote" | "baseline" | "template" | "market" | "poolKey" | "curve" | "vaultPosition" | "vaultSolvency" | "gaugePosition" | "liability";
  readonly key: string;
  readonly value: Readonly<Record<string, unknown>>;
}

export interface ObservationRequest {
  readonly kind: ChainObservation["kind"];
  readonly key: string;
  readonly reason: string;
}

export interface EventFact {
  readonly provenance: Provenance;
  readonly signature: V1EventSignature;
  readonly args: unknown;
}

export interface ConfigProjection {
  readonly kind: "asset" | "quote" | "baseline" | "template";
  readonly id: string;
  readonly status: bigint;
  readonly values: Readonly<Record<string, unknown>>;
  readonly provenance: Provenance;
}

export interface MarketProjection {
  readonly marketId: string;
  readonly values: Readonly<Record<string, unknown>>;
  readonly provenance: Provenance;
}

export interface PositionProjection {
  readonly key: string;
  readonly values: Readonly<Record<string, unknown>>;
  readonly provenance: Provenance;
}

export interface SwapProjection {
  readonly eventKey: string;
  readonly poolId: string;
  readonly values: Readonly<Record<string, unknown>>;
  readonly hookFeeEventKey?: string;
  readonly feeId?: string;
  readonly provenance: Provenance;
}

export interface V1IndexerState {
  readonly events: Map<string, EventFact>;
  readonly configs: Map<string, ConfigProjection>;
  readonly markets: Map<string, MarketProjection>;
  readonly pools: Map<string, PositionProjection>;
  readonly poolEvents: Map<string, PositionProjection>;
  readonly curveTrades: Map<string, PositionProjection>;
  readonly stockPositions: Map<string, PositionProjection>;
  readonly allocations: Map<string, PositionProjection>;
  readonly activationBuckets: Map<string, PositionProjection>;
  readonly gaugePositions: Map<string, PositionProjection>;
  readonly rewardExits: Map<string, PositionProjection>;
  readonly feeCredits: Map<string, PositionProjection>;
  readonly feeClaims: Map<string, PositionProjection>;
  readonly feeClaimTotals: Map<string, PositionProjection>;
  readonly swaps: Map<string, SwapProjection>;
  readonly observations: Map<string, PositionProjection>;
  lastPosition?: Provenance;
}

export function createIndexerState(): V1IndexerState {
  return {
    events: new Map(), configs: new Map(), markets: new Map(), pools: new Map(), poolEvents: new Map(), curveTrades: new Map(),
    stockPositions: new Map(), allocations: new Map(), activationBuckets: new Map(), gaugePositions: new Map(),
    rewardExits: new Map(),
    feeCredits: new Map(), feeClaims: new Map(), feeClaimTotals: new Map(), swaps: new Map(), observations: new Map(),
  };
}

export function eventKey(position: EventPosition): string {
  return `${position.chainId}:${position.transactionHash.toLowerCase()}:${position.logIndex}`;
}
