import { isDeepStrictEqual } from "node:util";
import type { PositionProjection, V2IndexerState } from "./schema.ts";

export type ReconciliationKind = "vaultPrincipal" | "gaugePosition" | "feeVaultLiability" | "sourceVersion" | "poolBinding";
export type ProjectionTable = "markets" | "pools" | "stockPositions" | "allocations" | "gaugePositions" | "observations";

export interface ReconciliationProbe {
  readonly kind: ReconciliationKind;
  readonly table: ProjectionTable;
  readonly key: string;
  readonly field: string;
  readonly onchainValue: unknown;
  readonly comparison?: "equal" | "atLeast";
}

export interface ReconciliationAlert extends ReconciliationProbe {
  readonly projectedValue: unknown;
  readonly blockNumber: bigint;
  readonly blockHash: string;
}

function projection(state: V2IndexerState, table: ProjectionTable, key: string): PositionProjection | undefined {
  if (table === "markets") {
    const market = state.markets.get(key.toLowerCase());
    return market ? { key: market.marketId, values: market.values, provenance: market.provenance } : undefined;
  }
  return state[table].get(key.toLowerCase());
}

export function reconcileAtTip(state: V2IndexerState, probes: readonly ReconciliationProbe[]): readonly ReconciliationAlert[] {
  const tip = state.lastPosition;
  if (!tip) throw new Error("cannot reconcile an empty V2 index");
  const alerts: ReconciliationAlert[] = [];
  for (const probe of probes) {
    const projectedValue = projection(state, probe.table, probe.key)?.values[probe.field];
    const matches = probe.comparison === "atLeast"
      ? typeof probe.onchainValue === "bigint" && typeof projectedValue === "bigint" && probe.onchainValue >= projectedValue
      : isDeepStrictEqual(projectedValue, probe.onchainValue);
    if (!matches) {
      alerts.push({ ...probe, projectedValue, blockNumber: tip.blockNumber, blockHash: tip.blockHash });
    }
  }
  return alerts;
}
