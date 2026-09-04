import assert from "node:assert/strict";
import { once } from "node:events";
import { request } from "node:http";
import { test } from "node:test";
import {
  createReadApiServer,
  EXECUTION_SPEC_ID,
  HEALTH_RESPONSE,
  InMemoryReadModelRepository,
  type MarketReadModel,
  type SourceBlock,
} from "../src/index.ts";

const id = (value: string): `0x${string}` => `0x${value.padStart(64, "0")}`;
const address = (value: string): `0x${string}` => `0x${value.padStart(40, "0")}`;
const source: SourceBlock = { chainId: 4663, blockNumber: "100", blockHash: id("b"), transactionHash: id("a"), transactionIndex: 1, logIndex: 2 };
const sync = {
  chainId: 4663 as const, status: "synced" as const, blockNumber: "100", blockHash: id("b"), finality: "finalized" as const,
  headBlockNumber: "102", headBlockHash: id("c"), lagBlocks: "2", revision: "100:0x0b",
};

function market(suffix: string, assetUid = id("9")): MarketReadModel {
  return {
    marketId: id(suffix), assetUid, memeToken: address(`1${suffix}`), curve: address(`2${suffix}`), gauge: address(`3${suffix}`),
    quoteAsset: address("4"), quoteAssetConfigId: id("5"), ponsBaselineId: id("6"), sourceVersion: 1,
    launchPhase: 1,
    curveProgress: { realQuoteReserve: "30", sellableTokens: "40", reservedTokens: "60", accruedCurveFees: "2", readyToGraduate: false },
    poolId: id(`7${suffix}`),
    poolKey: { currency0: address("4"), currency1: address(`1${suffix}`), fee: 0, tickSpacing: 60, hooks: address("8") },
    canonicalRoute: {
      router: address("12"), quoter: address("13"), hook: address("8"), launchLocker: address("14"), graduationExecutor: address("15"),
      curveTradingEnabled: false, poolTradingEnabled: true, sourceVersion: 1, launchPhase: 1,
    },
    source,
  };
}

const repository = new InMemoryReadModelRepository({
    executionSpecId: "V1-EXEC-10",
  reconciliationAlerts: [],
  sync,
  markets: [market("3"), market("1"), market("2"), market("4", id("99"))],
  configs: [{ kind: "asset", id: id("9"), status: 1, values: { stockToken: address("9"), tokenDecimals: 18, minimumAllocation: "500000000000000000" }, source }],
  positions: [{
    user: address("a"), assetUid: id("9"), marketId: id("1"), free: "5", allocated: "7", pending: "2", active: "5",
    activationAt: "120", unlockAt: "3600",
    claimable: [
      { kind: "quote", asset: address("4"), amount: "11" },
      { kind: "meme", asset: address("11"), amount: "13" },
    ],
    source,
  }],
});

async function call(serverUrl: string, pathname: string, method = "GET"): Promise<{ statusCode: number; body: any }> {
  const url = new URL(pathname, serverUrl);
  const response = await new Promise<import("node:http").IncomingMessage>((resolve, reject) => {
    const req = request(url, { method }, resolve);
    req.on("error", reject);
    req.end();
  });
  const chunks: Buffer[] = [];
  for await (const chunk of response) chunks.push(Buffer.from(chunk));
  return { statusCode: response.statusCode ?? 0, body: JSON.parse(Buffer.concat(chunks).toString("utf8")) };
}

async function withServer(run: (baseUrl: string) => Promise<void>): Promise<void> {
  const server = createReadApiServer(repository).listen(0, "127.0.0.1");
  await once(server, "listening");
  const serverAddress = server.address();
  assert.ok(serverAddress && typeof serverAddress !== "string");
  try { await run(`http://127.0.0.1:${serverAddress.port}`); } finally { server.close(); }
}

test("health endpoint exposes read-only runtime and explicit sync state", async () => withServer(async (baseUrl) => {
  const result = await call(baseUrl, "/health");
  assert.equal(result.statusCode, 200);
  assert.deepEqual(result.body, { ...HEALTH_RESPONSE, sync });
  assert.equal(EXECUTION_SPEC_ID, "V1-EXEC-10");
}));

test("market discovery is canonical, filterable, and cursor paginated with a hard limit", async () => withServer(async (baseUrl) => {
  const first = await call(baseUrl, `/v1/markets?assetUid=${id("9")}&limit=2`);
  assert.equal(first.statusCode, 200);
  assert.deepEqual(first.body.items.map((item: MarketReadModel) => item.marketId), [id("1"), id("2")]);
  assert.equal(first.body.items[0].poolKey.hooks, address("8"));
  assert.equal(first.body.items[0].source.blockHash, id("b"));
  assert.equal(typeof first.body.nextCursor, "string");
  const second = await call(baseUrl, `/v1/markets?assetUid=${id("9")}&limit=2&cursor=${first.body.nextCursor}`);
  assert.deepEqual(second.body.items.map((item: MarketReadModel) => item.marketId), [id("3")]);
  assert.equal(second.body.nextCursor, null);
  assert.equal((await call(baseUrl, "/v1/markets?limit=101")).statusCode, 400);
  assert.equal((await call(baseUrl, "/v1/markets?cursor=***")).statusCode, 400);
  assert.equal((await call(baseUrl, `/v1/markets?assetUid=${id("99")}&cursor=${first.body.nextCursor}`)).statusCode, 400);
  assert.equal((await call(baseUrl, "/v1/markets?assetUid=not-a-bytes32")).statusCode, 400);
}));

test("market detail returns full PoolKey, Curve progress, lifecycle, and source block", async () => withServer(async (baseUrl) => {
  const result = await call(baseUrl, `/v1/markets/${id("1")}`);
  assert.equal(result.statusCode, 200);
  assert.deepEqual(result.body.market.poolKey, market("1").poolKey);
  assert.equal(result.body.market.canonicalRoute.router, address("12"));
  assert.equal(result.body.market.curveProgress.realQuoteReserve, "30");
  assert.equal(result.body.market.launchPhase, 1);
  assert.equal(result.body.market.curveProgress.reservedTokens, "60");
  assert.equal(result.body.market.source.transactionIndex, 1);
  assert.equal(result.body.sync.finality, "finalized");
  assert.equal(result.body.sync.lagBlocks, "2");
  assert.deepEqual(result.body.sync, sync);
  assert.equal((await call(baseUrl, `/v1/markets/${id("99")}`)).statusCode, 404);
}));

test("config and user position endpoints expose bounded chain facts and dual-asset claimables", async () => withServer(async (baseUrl) => {
  const configs = await call(baseUrl, "/v1/config/asset?limit=10");
  assert.equal(configs.body.items[0].id, id("9"));
  assert.equal(configs.body.items[0].source.logIndex, 2);
  const positions = await call(baseUrl, `/v1/users/${address("a")}/positions?limit=10`);
  assert.equal(positions.body.items[0].free, "5");
  assert.equal(positions.body.items[0].pending, "2");
  assert.equal(positions.body.items[0].active, "5");
  assert.equal(positions.body.items[0].unlockAt, "3600");
  assert.deepEqual(positions.body.items[0].claimable.map((claim: { kind: string }) => claim.kind), ["quote", "meme"]);
}));

test("all write methods fail closed and unknown routes remain JSON 404", async () => withServer(async (baseUrl) => {
  const write = await call(baseUrl, "/v1/markets", "POST");
  assert.equal(write.statusCode, 405);
  assert.deepEqual(write.body, { error: "read_only", message: "this API does not accept write methods", allowedMethods: ["GET"], sync });
  const missing = await call(baseUrl, "/v1/not-implemented");
  assert.equal(missing.statusCode, 404);
  assert.equal(missing.body.error, "not_found");
}));

test("repository rejects unreconciled, noncanonical, or internally inconsistent snapshots", () => {
  assert.throws(() => new InMemoryReadModelRepository({
    executionSpecId: "V1-EXEC-10", reconciliationAlerts: [{}] as never,
    sync, markets: [market("1")],
  }), /not V1-reconciled/);
  assert.throws(() => new InMemoryReadModelRepository({
    executionSpecId: "V1-EXEC-10", reconciliationAlerts: [], sync,
    markets: [{ ...market("1"), canonicalRoute: { ...market("1").canonicalRoute, hook: address("99") } }],
  }), /PoolKey hook/);
  assert.throws(() => new InMemoryReadModelRepository({
    executionSpecId: "V1-EXEC-10", reconciliationAlerts: [], sync,
    markets: [{ ...market("1"), launchPhase: 2 as never, canonicalRoute: { ...market("1").canonicalRoute, launchPhase: 2 as never } }],
  }), /launchPhase must be/);
  assert.throws(() => new InMemoryReadModelRepository({
    executionSpecId: "V1-EXEC-10", reconciliationAlerts: [], sync, markets: [market("1")],
    positions: [{ ...repository.positions(address("a"))[0]!, allocated: "8" }],
  }), /allocated must equal pending plus active/);
  assert.throws(() => new InMemoryReadModelRepository({
    executionSpecId: "V1-EXEC-10", reconciliationAlerts: [], sync,
    configs: [{ kind: "asset", id: id("9"), status: 1, values: { minimumAllocation: "413" }, source }],
  }), /minimumAllocation/);
});
