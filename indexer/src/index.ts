export const INDEXER_DESCRIPTOR = Object.freeze({
  chainId: 4663 as const,
  executionSpecId: "V1-EXEC-9" as const,
  status: "reorg-replay-and-reconciliation" as const,
  handlersImplemented: true as const,
});

export { applyV1Event } from "./projector.ts";
export { requiredObservations } from "./observation-plan.ts";
export { decodeCheckpoint, encodeCheckpoint, JsonCheckpointStore } from "./checkpoint.ts";
export type { CanonicalBlock, CheckpointStore, IndexerCheckpoint } from "./checkpoint.ts";
export { CanonicalReplayEngine } from "./replay.ts";
export { reconcileAtTip } from "./reconciliation.ts";
export type { ReconciliationAlert, ReconciliationKind, ReconciliationProbe } from "./reconciliation.ts";
export { createIndexerState, eventKey } from "./schema.ts";
export type { ChainObservation, DecodedV1Event, EventPosition, ObservationRequest, V1IndexerState } from "./schema.ts";
export { V1_EVENT_ABI } from "./generated/v1-events.ts";

export function getIndexerDescriptor(): typeof INDEXER_DESCRIPTOR {
  return INDEXER_DESCRIPTOR;
}

if (process.argv[1]?.endsWith("/index.js") || process.argv[1]?.endsWith("/index.ts")) {
  process.stdout.write(`${JSON.stringify(INDEXER_DESCRIPTOR)}\n`);
}
