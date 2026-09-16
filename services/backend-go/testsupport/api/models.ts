import type { SyncStatus } from "../../openapi/generated/v1-client.ts";

export const EXECUTION_SPEC_ID = "V1-EXEC-11" as const;

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
} from "../../openapi/generated/v1-client.ts";

export interface Page<T> {
  readonly items: readonly T[];
  readonly nextCursor: string | null;
  readonly sync: SyncStatus;
}
