import type { SyncStatus } from "./generated/v2-client.ts";

export const EXECUTION_SPEC_ID = "V2-EXEC-3" as const;

export type {
  ApiErrorResponse,
  CanonicalRoute,
  ConfigReadModel,
  CurveProgress,
  HealthResponse,
  MarketReadModel,
  MemeClaimable,
  PoolKeyReadModel,
  QuoteClaimable,
  SourceBlock,
  SyncStatus,
  UserPositionReadModel,
} from "./generated/v2-client.ts";

export interface Page<T> {
  readonly items: readonly T[];
  readonly nextCursor: string | null;
  readonly sync: SyncStatus;
}
