import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertSchemaVersionTransition } from "./openapi-versioning.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const specPath = path.join(root, "openapi/v2.json");
const lockPath = path.join(root, "openapi/v2.lock.json");
const clientPath = path.join(root, "src/generated/v2-client.ts");
const ref = (name) => ({ $ref: `#/components/schemas/${name}` });
const nullable = (schema) => ({ oneOf: [schema, { type: "null" }] });
const object = (properties, required = Object.keys(properties), extra = {}) => ({ type: "object", additionalProperties: false, properties, required, ...extra });
const uintString = { type: "string", pattern: "^(0|[1-9][0-9]*)$" };
const address = { type: "string", pattern: "^0x[0-9a-f]{40}$" };
const bytes32 = { type: "string", pattern: "^0x[0-9a-f]{64}$" };
const source = object({ chainId: { type: "integer", const: 4663 }, blockNumber: uintString, blockHash: bytes32, transactionHash: bytes32, transactionIndex: { type: "integer", minimum: 0 }, logIndex: { type: "integer", minimum: 0 } });
const sync = object({
  chainId: { type: "integer", const: 4663 }, status: { type: "string", enum: ["synced", "lagging", "unavailable"] },
  blockNumber: nullable(uintString), blockHash: nullable(bytes32), finality: { type: "string", enum: ["finalized", "safe", "head", "unavailable"] },
  headBlockNumber: nullable(uintString), headBlockHash: nullable(bytes32), lagBlocks: nullable(uintString), revision: { type: "string", minLength: 1 },
});
const poolKey = object({ currency0: address, currency1: address, fee: { type: "integer", minimum: 0, maximum: 16777215 }, tickSpacing: { type: "integer", minimum: -8388608, maximum: 8388607 }, hooks: address });
const route = object({
  router: address, quoter: address, hook: address, launchLocker: address, graduationExecutor: address,
  curveTradingEnabled: { type: "boolean" }, poolTradingEnabled: { type: "boolean" }, sourceVersion: { type: "integer", minimum: 1 },
  launchPhase: { type: "integer", minimum: 0, maximum: 255 }, marketStatus: { type: "integer", minimum: 0, maximum: 255 },
});
const curve = object({ realQuoteReserve: uintString, sellableTokens: uintString, reservedTokens: uintString, accruedCurveFees: uintString, readyToGraduate: { type: "boolean" }, sweptAt: nullable(uintString) });
const market = object({
  marketId: bytes32, assetUid: bytes32, memeToken: address, curve: address, gauge: address, quoteAsset: address,
  quoteAssetConfigId: bytes32, ponsBaselineId: bytes32, sourceVersion: { type: "integer", minimum: 1 },
  launchPhase: { type: "integer", minimum: 0, maximum: 255 }, marketStatus: { type: "integer", minimum: 0, maximum: 255 },
  curveProgress: ref("CurveProgress"), poolId: nullable(bytes32), poolKey: nullable(ref("PoolKeyReadModel")),
  canonicalRoute: ref("CanonicalRoute"), source: ref("SourceBlock"),
}, undefined, { description: "poolId and poolKey are null or non-null together." });
const configValue = { oneOf: [{ type: "string" }, { type: "number" }, { type: "boolean" }, { type: "null" }] };
const config = object({ kind: { type: "string", enum: ["asset", "quote", "pons", "template"] }, id: bytes32, status: { type: "integer", minimum: 0, maximum: 255 }, values: { type: "object", additionalProperties: configValue }, source: ref("SourceBlock") });
const claimQuote = object({ kind: { type: "string", const: "quote" }, asset: address, amount: uintString });
const claimMeme = object({ kind: { type: "string", const: "meme" }, asset: address, amount: uintString });
const position = object({
  user: address, assetUid: bytes32, marketId: bytes32, free: uintString, allocated: uintString, pending: uintString, active: uintString,
  activationAt: nullable(uintString), unlockAt: nullable(uintString),
  claimable: { type: "array", prefixItems: [ref("QuoteClaimable"), ref("MemeClaimable")], minItems: 2, maxItems: 2 }, source: ref("SourceBlock"),
});
const page = (item) => object({ items: { type: "array", items: ref(item) }, nextCursor: nullable({ type: "string", minLength: 1 }), sync: ref("SyncStatus") });
const error = object({
  error: { type: "string", enum: ["invalid_request", "market_not_found", "not_found", "read_only"] }, message: { type: "string" },
  allowedMethods: { type: "array", prefixItems: [{ type: "string", const: "GET" }], minItems: 1, maxItems: 1 }, sync: ref("SyncStatus"),
}, ["error", "message", "sync"]);

const queryParameters = [
  { name: "limit", in: "query", required: false, schema: { type: "integer", minimum: 1, maximum: 100, default: 50 } },
  { name: "cursor", in: "query", required: false, description: "Opaque cursor bound to endpoint, normalized filter and Indexer revision.", schema: { type: "string", minLength: 1 } },
];
const response = (schema, description = "Success") => ({ description, content: { "application/json": { schema } } });
const errors = { "400": response(ref("ApiErrorResponse"), "Invalid input or cursor snapshot"), "405": response(ref("ApiErrorResponse"), "Read-only API") };

const spec = {
  openapi: "3.1.0",
  info: { title: "TickerGarden V2 Read API", version: "2.1.0", description: "Non-custodial read API backed only by reconciled V2 Indexer facts." },
  "x-execution-spec-id": "V2-EXEC-4",
  paths: {
    "/health": { get: { operationId: "getHealth", responses: { "200": response(ref("HealthResponse")), ...errors } } },
    "/v2/markets": { get: { operationId: "listMarkets", parameters: [{ name: "assetUid", in: "query", required: false, schema: bytes32 }, ...queryParameters], responses: { "200": response(ref("MarketPage")), ...errors } } },
    "/v2/markets/{marketId}": { get: { operationId: "getMarket", parameters: [{ name: "marketId", in: "path", required: true, schema: bytes32 }], responses: { "200": response(ref("MarketDetailResponse")), "404": response(ref("ApiErrorResponse"), "Market not found"), ...errors } } },
    "/v2/config/{kind}": { get: { operationId: "listConfig", parameters: [{ name: "kind", in: "path", required: true, schema: { type: "string", enum: ["asset", "quote", "pons", "template"] } }, ...queryParameters], responses: { "200": response(ref("ConfigPage")), ...errors } } },
    "/v2/users/{address}/positions": { get: { operationId: "listUserPositions", parameters: [{ name: "address", in: "path", required: true, schema: address }, ...queryParameters], responses: { "200": response(ref("PositionPage")), ...errors } } },
  },
  components: { schemas: {
    SourceBlock: source, SyncStatus: sync, PoolKeyReadModel: poolKey, CanonicalRoute: route, CurveProgress: curve,
    MarketReadModel: market, ConfigReadModel: config, QuoteClaimable: claimQuote, MemeClaimable: claimMeme,
    UserPositionReadModel: position, MarketPage: page("MarketReadModel"), ConfigPage: page("ConfigReadModel"),
    PositionPage: page("UserPositionReadModel"), MarketDetailResponse: object({ market: ref("MarketReadModel"), sync: ref("SyncStatus") }),
    HealthResponse: object({
      executionSpecId: { type: "string", const: "V2-EXEC-4" }, status: { type: "string", const: "read-api" }, readApiImplemented: { type: "boolean", const: true },
      productRuntimeImplemented: { type: "boolean", const: false }, custody: { type: "boolean", const: false }, transactionSubmission: { type: "boolean", const: false }, sync: ref("SyncStatus"),
    }), ApiErrorResponse: error,
  } },
};

const schemaToType = (schema) => {
  if (schema.$ref) return schema.$ref.split("/").at(-1);
  if (schema.const !== undefined) return JSON.stringify(schema.const);
  if (schema.enum) return schema.enum.map((value) => JSON.stringify(value)).join(" | ");
  if (schema.oneOf) return schema.oneOf.map(schemaToType).join(" | ");
  if (schema.type === "null") return "null";
  if (schema.type === "string") return schema.pattern?.startsWith("^0x") ? "`0x${string}`" : "string";
  if (schema.type === "integer" || schema.type === "number") return "number";
  if (schema.type === "boolean") return "boolean";
  if (schema.type === "array") {
    if (schema.prefixItems) return `readonly [${schema.prefixItems.map(schemaToType).join(", ")}]`;
    return `readonly ${schemaToType(schema.items)}[]`;
  }
  if (schema.type === "object") {
    const required = new Set(schema.required ?? []);
    const fields = Object.entries(schema.properties ?? {}).map(([name, child]) => `readonly ${name}${required.has(name) ? "" : "?"}: ${schemaToType(child)};`);
    if (schema.additionalProperties && typeof schema.additionalProperties === "object") fields.push(`readonly [key: string]: ${schemaToType(schema.additionalProperties)};`);
    return `{ ${fields.join(" ")} }`;
  }
  throw new Error(`unsupported OpenAPI schema node: ${JSON.stringify(schema)}`);
};

const typeLines = Object.entries(spec.components.schemas).map(([name, schema]) => `export type ${name} = ${schemaToType(schema)};`);
const operations = Object.entries(spec.paths).map(([routePath, pathItem]) => {
  const operation = pathItem.get;
  const parameters = operation.parameters ?? [];
  const parameterFields = parameters.map((parameter) => `readonly ${parameter.name}${parameter.required ? "" : "?"}: ${schemaToType(parameter.schema)};`).join(" ");
  const paramsType = `${operation.operationId[0].toUpperCase()}${operation.operationId.slice(1)}Params`;
  const responseSchema = operation.responses["200"].content["application/json"].schema.$ref.split("/").at(-1);
  typeLines.push(`export type ${paramsType} = { ${parameterFields} };`);
  const required = parameters.some((parameter) => parameter.required);
  const signature = parameters.length === 0 ? "" : `params: ${paramsType}${required ? "" : " = {}"}`;
  let urlExpression = `\`${routePath.replaceAll(/\{([^}]+)\}/g, "${encodeURIComponent(params.$1)}")}\``;
  const validations = parameters.map((parameter) => {
    const checks = [];
    if (parameter.schema.pattern) checks.push(`!new RegExp(${JSON.stringify(parameter.schema.pattern)}).test(String(params.${parameter.name}))`);
    if (parameter.schema.minimum !== undefined) checks.push(`Number(params.${parameter.name}) < ${parameter.schema.minimum}`);
    if (parameter.schema.maximum !== undefined) checks.push(`Number(params.${parameter.name}) > ${parameter.schema.maximum}`);
    if (checks.length === 0) return "";
    const statement = `if (${checks.join(" || ")}) throw new TypeError("invalid ${parameter.name}");`;
    return parameter.required ? statement : `if (params.${parameter.name} !== undefined) { ${statement} }`;
  }).join(" ");
  const query = parameters.filter((parameter) => parameter.in === "query").map((parameter) =>
    `if (params.${parameter.name} !== undefined) url.searchParams.set("${parameter.name}", String(params.${parameter.name}));`,
  ).join(" ");
  return `  async ${operation.operationId}(${signature}): Promise<${responseSchema}> { ${validations} const url = new URL(${urlExpression}, this.baseUrl); ${query} return this.request<${responseSchema}>(url); }`;
});
const client = `// Generated from openapi/v2.json by scripts/generate-openapi.mjs. Do not edit.\n\n${typeLines.join("\n")}\n\nexport class TickerGardenApiError extends Error { readonly status: number; readonly body: ApiErrorResponse; constructor(status: number, body: ApiErrorResponse) { super(body.message); this.name = "TickerGardenApiError"; this.status = status; this.body = body; } }\n\nexport class TickerGardenV2Client { readonly baseUrl: string; readonly fetcher: typeof fetch; constructor(baseUrl: string, fetcher: typeof fetch = fetch) { this.baseUrl = baseUrl; this.fetcher = fetcher; } private async request<T>(url: URL): Promise<T> { const response = await this.fetcher(url, { method: "GET", headers: { accept: "application/json" } }); const body: unknown = await response.json(); if (!response.ok) throw new TickerGardenApiError(response.status, body as ApiErrorResponse); return body as T; }\n${operations.join("\n")}\n}\n`;
const specText = `${JSON.stringify(spec, null, 2)}\n`;
const fingerprint = `sha256:${createHash("sha256").update(specText).digest("hex")}`;
const nextLock = { schemaVersion: 1, openapiVersion: spec.info.version, executionSpecId: "V2-EXEC-4", fingerprint };
const lockText = `${JSON.stringify(nextLock, null, 2)}\n`;
const previousLock = await readFile(lockPath, "utf8").then(JSON.parse).catch(() => null);

if (process.argv.includes("--check")) {
  const [currentSpec, currentClient, currentLock] = await Promise.all([
    readFile(specPath, "utf8").catch(() => ""), readFile(clientPath, "utf8").catch(() => ""), readFile(lockPath, "utf8").catch(() => ""),
  ]);
  if (currentSpec !== specText || currentClient !== client || currentLock !== lockText) {
    throw new Error("generated OpenAPI, client, or version lock is stale");
  }
} else {
  if (previousLock) assertSchemaVersionTransition(previousLock.openapiVersion, spec.info.version, previousLock.fingerprint !== fingerprint);
  await Promise.all([mkdir(path.dirname(specPath), { recursive: true }), mkdir(path.dirname(clientPath), { recursive: true })]);
  await Promise.all([writeFile(specPath, specText), writeFile(clientPath, client), writeFile(lockPath, lockText)]);
}
