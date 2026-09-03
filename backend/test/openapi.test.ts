import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  TickerGardenApiError,
  TickerGardenV2Client,
  type ApiErrorResponse,
  type MarketPage,
} from "../src/index.ts";

const id = (value: string): `0x${string}` => `0x${value.padStart(64, "0")}`;
const address = (value: string): `0x${string}` => `0x${value.padStart(40, "0")}`;
const spec = JSON.parse(await readFile(new URL("../openapi/v2.json", import.meta.url), "utf8"));

test("OpenAPI publishes the five read endpoints and no write operation", () => {
  assert.equal(spec.openapi, "3.1.0");
  assert.equal(spec.info.version, "2.0.0");
  assert.equal(spec["x-execution-spec-id"], "V2-EXEC-3");
  assert.deepEqual(Object.keys(spec.paths).sort(), [
    "/health",
    "/v2/config/{kind}",
    "/v2/markets",
    "/v2/markets/{marketId}",
    "/v2/users/{address}/positions",
  ]);
  for (const pathItem of Object.values(spec.paths) as Record<string, unknown>[]) {
    assert.deepEqual(Object.keys(pathItem), ["get"]);
  }
});

test("OpenAPI preserves chain provenance, integer precision, nullability, and error envelopes", () => {
  const schemas = spec.components.schemas;
  assert.deepEqual(schemas.SourceBlock.required, [
    "chainId", "blockNumber", "blockHash", "transactionHash", "transactionIndex", "logIndex",
  ]);
  assert.equal(schemas.SourceBlock.properties.transactionIndex.minimum, 0);
  assert.equal(schemas.MarketReadModel.properties.stakeSaturationAmount.pattern, "^(0|[1-9][0-9]*)$");
  assert.equal(schemas.CurveProgress.properties.realQuoteReserve.type, "string");
  assert.deepEqual(schemas.CurveProgress.properties.sweptAt.oneOf[1], { type: "null" });
  assert.deepEqual(schemas.MarketReadModel.properties.poolKey.oneOf[1], { type: "null" });
  assert.deepEqual(schemas.ApiErrorResponse.required, ["error", "message", "sync"]);
  assert.ok(spec.paths["/v2/markets"].get.responses["400"]);
  assert.ok(spec.paths["/v2/markets/{marketId}"].get.responses["404"]);
  assert.ok(spec.paths["/v2/markets"].get.responses["405"]);
});

test("generated client sends GET requests with encoded typed parameters", async () => {
  const calls: Array<{ url: URL; init: RequestInit | undefined }> = [];
  const page: MarketPage = {
    items: [], nextCursor: null,
    sync: {
      chainId: 4663, status: "synced", blockNumber: "10", blockHash: id("1"), finality: "finalized",
      headBlockNumber: "10", headBlockHash: id("1"), lagBlocks: "0", revision: "10:0x01",
    },
  };
  const fetcher: typeof fetch = async (input, init) => {
    calls.push({ url: new URL(input instanceof Request ? input.url : input.toString()), init });
    return new Response(JSON.stringify(page), { status: 200, headers: { "content-type": "application/json" } });
  };
  const client = new TickerGardenV2Client("https://api.example.test/root", fetcher);
  await client.listMarkets({ assetUid: id("9"), limit: 2, cursor: "opaque cursor" });
  await client.getMarket({ marketId: id("7") });
  await client.listConfig({ kind: "quote", limit: 3 });
  await client.listUserPositions({ address: address("a"), cursor: "next" });

  assert.equal(calls.length, 4);
  assert.equal(calls[0]!.url.pathname, "/v2/markets");
  assert.equal(calls[0]!.url.searchParams.get("assetUid"), id("9"));
  assert.equal(calls[0]!.url.searchParams.get("cursor"), "opaque cursor");
  assert.equal(calls[1]!.url.pathname, `/v2/markets/${id("7")}`);
  assert.equal(calls[2]!.url.pathname, "/v2/config/quote");
  assert.equal(calls[3]!.url.pathname, `/v2/users/${address("a")}/positions`);
  for (const call of calls) {
    assert.equal(call.init?.method, "GET");
    assert.deepEqual(call.init?.headers, { accept: "application/json" });
  }
});

test("generated client rejects malformed input before fetch and exposes typed API errors", async () => {
  let calls = 0;
  const sync = {
    chainId: 4663 as const, status: "synced" as const, blockNumber: "10", blockHash: id("1"), finality: "finalized" as const,
    headBlockNumber: "10", headBlockHash: id("1"), lagBlocks: "0", revision: "10:0x01",
  };
  const body: ApiErrorResponse = { error: "invalid_request", message: "bad request", sync };
  const fetcher: typeof fetch = async () => {
    calls += 1;
    return new Response(JSON.stringify(body), { status: 400, headers: { "content-type": "application/json" } });
  };
  const client = new TickerGardenV2Client("https://api.example.test", fetcher);

  await assert.rejects(client.getMarket({ marketId: "0x12" }), /invalid marketId/);
  await assert.rejects(client.listMarkets({ assetUid: "0x12" }), /invalid assetUid/);
  await assert.rejects(client.listUserPositions({ address: "0x12" }), /invalid address/);
  await assert.rejects(client.listMarkets({ limit: 101 }), /invalid limit/);
  assert.equal(calls, 0);

  await assert.rejects(client.listMarkets(), (error: unknown) => {
    assert.ok(error instanceof TickerGardenApiError);
    assert.equal(error.status, 400);
    assert.deepEqual(error.body, body);
    return true;
  });
  assert.equal(calls, 1);
});
