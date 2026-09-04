import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { EXECUTION_SPEC_ID, type Page } from "./models.ts";
import { paginate, parsePageRequest } from "./pagination.ts";
import { EMPTY_REPOSITORY, type ConfigKind, type ReadModelRepository } from "./repository.ts";

export { EXECUTION_SPEC_ID } from "./models.ts";
export type { ApiErrorResponse, ConfigReadModel, MarketReadModel, Page, PoolKeyReadModel, SourceBlock, SyncStatus, UserPositionReadModel } from "./models.ts";
export { InMemoryReadModelRepository } from "./repository.ts";
export type { ConfigKind, ReadModelRepository } from "./repository.ts";
export { TickerGardenApiError, TickerGardenV1Client } from "./generated/v1-client.ts";
export type { ConfigPage, HealthResponse, MarketDetailResponse, MarketPage, PositionPage } from "./generated/v1-client.ts";

export const HEALTH_RESPONSE = Object.freeze({
  executionSpecId: EXECUTION_SPEC_ID,
  status: "read-api" as const,
  readApiImplemented: true as const,
  productRuntimeImplemented: true as const,
  custody: false as const,
  transactionSubmission: false as const,
});

function sendJson(response: ServerResponse, statusCode: number, body: unknown): void {
  const payload = JSON.stringify(body);
  response.statusCode = statusCode;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.setHeader("content-length", Buffer.byteLength(payload));
  response.end(payload);
}

const configKinds = new Set<ConfigKind>(["asset", "quote", "pons", "template"]);

export function handleRequest(request: IncomingMessage, response: ServerResponse, repository: ReadModelRepository = EMPTY_REPOSITORY): void {
  try {
    const method = request.method ?? "GET";
    const url = new URL(request.url ?? "/", "http://ticker.garden");
    if (method !== "GET") {
      sendJson(response, 405, { error: "read_only", message: "this API does not accept write methods", allowedMethods: ["GET"], sync: repository.syncStatus() });
      return;
    }
    if (url.pathname === "/health") {
      sendJson(response, 200, { ...HEALTH_RESPONSE, sync: repository.syncStatus() });
      return;
    }
    if (url.pathname === "/v1/markets") {
      const assetUid = url.searchParams.get("assetUid")?.toLowerCase();
      if (assetUid !== undefined && !/^0x[0-9a-f]{64}$/.test(assetUid)) throw new Error("assetUid must be a canonical bytes32");
      const pageRequest = parsePageRequest(url.searchParams, {
        scope: "markets", filter: assetUid ?? "all", snapshot: repository.syncStatus().revision,
      });
      const markets = assetUid ? repository.markets().filter((market) => market.assetUid.toLowerCase() === assetUid) : repository.markets();
      const page = paginate(markets, pageRequest, (market) => market.marketId);
      sendJson(response, 200, { ...page, sync: repository.syncStatus() } satisfies Page<(typeof markets)[number]>);
      return;
    }
    const marketMatch = /^\/v1\/markets\/(0x[0-9a-fA-F]{64})$/.exec(url.pathname);
    if (marketMatch) {
      const market = repository.market(marketMatch[1]!);
      if (!market) sendJson(response, 404, { error: "market_not_found", message: "the canonical market was not found", sync: repository.syncStatus() });
      else sendJson(response, 200, { market, sync: repository.syncStatus() });
      return;
    }
    const configMatch = /^\/v1\/config\/(asset|quote|pons|template)$/.exec(url.pathname);
    if (configMatch && configKinds.has(configMatch[1] as ConfigKind)) {
      const kind = configMatch[1] as ConfigKind;
      const pageRequest = parsePageRequest(url.searchParams, {
        scope: `config:${kind}`, filter: "all", snapshot: repository.syncStatus().revision,
      });
      const page = paginate(repository.configs(kind), pageRequest, (config) => config.id);
      sendJson(response, 200, { ...page, sync: repository.syncStatus() });
      return;
    }
    const positionMatch = /^\/v1\/users\/(0x[0-9a-fA-F]{40})\/positions$/.exec(url.pathname);
    if (positionMatch) {
      const pageRequest = parsePageRequest(url.searchParams, {
        scope: "positions", filter: positionMatch[1]!.toLowerCase(), snapshot: repository.syncStatus().revision,
      });
      const positions = repository.positions(positionMatch[1]!);
      const page = paginate(positions, pageRequest, (position) => `${position.assetUid}:${position.marketId}`);
      sendJson(response, 200, { ...page, sync: repository.syncStatus() });
      return;
    }
    sendJson(response, 404, { error: "not_found", message: "route not found", sync: repository.syncStatus() });
  } catch (error) {
    sendJson(response, 400, { error: "invalid_request", message: error instanceof Error ? error.message : "invalid request", sync: repository.syncStatus() });
  }
}

export function createReadApiServer(repository: ReadModelRepository = EMPTY_REPOSITORY): Server {
  return createServer((request, response) => handleRequest(request, response, repository));
}

export const createHealthServer = createReadApiServer;

if (process.argv[1]?.endsWith("/index.js") || process.argv[1]?.endsWith("/index.ts")) {
  const host = process.env.TICKERGARDEN_API_HOST ?? "127.0.0.1";
  const port = Number(process.env.TICKERGARDEN_API_PORT ?? 8788);
  createReadApiServer().listen(port, host, () => console.log(`TickerGarden V1 read API listening on http://${host}:${port}`));
}
