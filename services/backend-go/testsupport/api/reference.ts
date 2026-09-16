// Test-only reference evaluator. No HTTP server, storage, wallet, or executable service entry point.
import { queryMarkets, MarketIdentityUnavailable } from "./market-query.ts";
import { EXECUTION_SPEC_ID, type Page } from "./models.ts";
import { paginate, parsePageRequest } from "./pagination.ts";
import type { ConfigKind, ReadModelRepository } from "./repository.ts";
export { InMemoryReadModelRepository } from "./repository.ts";
const result = (status: number, body: unknown) => ({status, body});
export const HEALTH_RESPONSE = Object.freeze({
  executionSpecId: EXECUTION_SPEC_ID,
  status: "read-api" as const,
  readApiImplemented: true as const,
  productRuntimeImplemented: true as const,
  custody: false as const,
  transactionSubmission: false as const,
});

const configKinds = new Set<ConfigKind>(["asset", "quote", "baseline", "template"]);

export function querySnapshot(path: string, repository: ReadModelRepository) {
  try {
    const url = new URL(path, "http://ticker.garden");
    const revision = url.searchParams.get("revision");
    if (revision !== null) {
      if (!/^[0-9]+:0x[0-9a-f]{64}$/.test(revision)) throw new Error("invalid snapshot revision");
      if (repository.syncStatus().revision !== revision) {
        const pinned = repository.atRevision?.(revision);
        if (!pinned) throw new Error("snapshot expired; restart this query from current health");
        repository = pinned;
      }
    }
    if (url.pathname === "/health") {
      return result(200, { ...HEALTH_RESPONSE, sync: repository.syncStatus() });
    }
    if (url.pathname === "/v1/markets") {
      const query = queryMarkets(repository.markets(), url.searchParams);
      const pageRequest = parsePageRequest(url.searchParams, { scope: "markets", filter: query.filter, snapshot: repository.syncStatus().revision });
      const markets = query.items;
      const page = paginate(markets, pageRequest, query.identity);
      return result(200, { ...page, sync: repository.syncStatus() } satisfies Page<(typeof markets)[number]>);
    }
    const marketMatch = /^\/v1\/markets\/(0x[0-9a-fA-F]{64})$/.exec(url.pathname);
    if (marketMatch) {
      const market = repository.market(marketMatch[1]!);
      if (!market) return result(404, { error: "market_not_found", message: "the canonical market was not found", sync: repository.syncStatus() });
      else return result(200, { market, sync: repository.syncStatus() });
    }
    const configMatch = /^\/v1\/config\/(asset|quote|baseline|template)$/.exec(url.pathname);
    if (configMatch && configKinds.has(configMatch[1] as ConfigKind)) {
      const kind = configMatch[1] as ConfigKind;
      const pageRequest = parsePageRequest(url.searchParams, {
        scope: `config:${kind}`, filter: "all", snapshot: repository.syncStatus().revision,
      });
      const page = paginate(repository.configs(kind), pageRequest, (config) => config.id);
      return result(200, { ...page, sync: repository.syncStatus() });
    }
    const positionMatch = /^\/v1\/users\/(0x[0-9a-fA-F]{40})\/positions$/.exec(url.pathname);
    if (positionMatch) {
      const pageRequest = parsePageRequest(url.searchParams, {
        scope: "positions", filter: positionMatch[1]!.toLowerCase(), snapshot: repository.syncStatus().revision,
      });
      const positions = repository.positions(positionMatch[1]!);
      const page = paginate(positions, pageRequest, (position) => `${position.assetUid}:${position.marketId}`);
      return result(200, { ...page, sync: repository.syncStatus() });
    }
    return result(404, { error: "not_found", message: "route not found", sync: repository.syncStatus() });
  } catch (error) {
    if(error instanceof MarketIdentityUnavailable){return result(503,{error:"identity_unavailable",message:error.message,sync:repository.syncStatus()});}
    return result(400, { error: "invalid_request", message: error instanceof Error ? error.message : "invalid request", sync: repository.syncStatus() });
  }
}

