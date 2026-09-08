import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  TickerGardenApiError,
  TickerGardenV1Client,
  type ApiErrorResponse,
  type MarketPage,
} from "../openapi/generated/v1-client.ts";

const id = (value: string): `0x${string}` => `0x${value.padStart(64, "0")}`;
const address = (value: string): `0x${string}` => `0x${value.padStart(40, "0")}`;
const spec = JSON.parse(await readFile(new URL("../openapi/v1.json", import.meta.url), "utf8"));

test("OpenAPI publishes the nineteen read endpoints and no write operation", () => {
  assert.equal(spec.openapi, "3.1.0");
  assert.equal(spec.info.version, "2.26.0");
  assert.equal(spec["x-execution-spec-id"], "V1-EXEC-11");
  assert.deepEqual(Object.keys(spec.paths).sort(), [
    "/health",
    "/v1/assets/{assetUid}/statistics",
    "/v1/config/{kind}",
    "/v1/markets",
    "/v1/markets/{marketId}",
    "/v1/markets/{marketId}/candles",
    "/v1/markets/{marketId}/detail",
    "/v1/markets/{marketId}/holders",
    "/v1/markets/{marketId}/trades",
    "/v1/prices/references",
    "/v1/stats/holders",
    "/v1/stats/overview",
    "/v1/stats/series",
    "/v1/transactions/{txHash}",
    "/v1/updates",
    "/v1/users/{address}/accounts",
    "/v1/users/{address}/activity",
    "/v1/users/{address}/positions",
    "/v1/users/{address}/rewards",
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
  assert.equal(schemas.MarketReadModel.properties.curveProgress.$ref, "#/components/schemas/CurveProgress");
  assert.equal(schemas.CurveProgress.properties.realQuoteReserve.type, "string");
  assert.deepEqual(Object.keys(schemas.CurveProgress.properties).sort(), [
    "accruedCurveFees", "readyToGraduate", "realQuoteReserve", "reservedTokens", "sellableTokens",
  ]);
  assert.deepEqual(schemas.MarketReadModel.properties.launchPhase.enum, [0, 1]);
  assert.deepEqual(schemas.CanonicalRoute.properties.launchPhase.enum, [0, 1]);
  assert.deepEqual(schemas.MarketReadModel.properties.poolKey.oneOf[1], { type: "null" });
  assert.deepEqual(schemas.ApiErrorResponse.required, ["error", "message", "sync"]);
  assert.ok(spec.paths["/v1/markets"].get.responses["400"]);
  assert.ok(spec.paths["/v1/markets/{marketId}"].get.responses["404"]);
  assert.ok(spec.paths["/v1/markets"].get.responses["405"]);
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
  const client = new TickerGardenV1Client("https://api.example.test/root", fetcher);
  await client.listMarkets({ assetUid: id("9"), limit: 2, cursor: "opaque cursor" });
  await client.getMarket({ marketId: id("7") });
  await client.listConfig({ kind: "quote", limit: 3 });
  await client.listUserPositions({ address: address("a"), cursor: "next" });

  await client.listUserRewards({address:address("a"),limit:1});
  assert.equal(calls[4]!.url.pathname, `/v1/users/${address("a")}/rewards`);
  assert.equal(calls.length, 5);
  assert.equal(calls[0]!.url.pathname, "/v1/markets");
  assert.equal(calls[0]!.url.searchParams.get("assetUid"), id("9"));
  assert.equal(calls[0]!.url.searchParams.get("cursor"), "opaque cursor");
  assert.equal(calls[1]!.url.pathname, `/v1/markets/${id("7")}`);
  assert.equal(calls[2]!.url.pathname, "/v1/config/quote");
  assert.equal(calls[3]!.url.pathname, `/v1/users/${address("a")}/positions`);
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
  const client = new TickerGardenV1Client("https://api.example.test", fetcher);

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

test("market query SDK validates new enums and transports combined filters", async () => {
  let calls = 0;
  const client = new TickerGardenV1Client("https://api.example", (async (url: URL | RequestInfo) => {
    calls++;
    const query = new URL(String(url)).searchParams;
    assert.equal(query.get("marketId"), id("a"));
    assert.equal(query.get("memeToken"), address("b"));
    assert.equal(query.get("launchPhase"), "1");
    assert.equal(query.get("sort"), "marketId_desc");
    return new Response(JSON.stringify({items:[],nextCursor:null}), {status:200});
  }) as typeof fetch);
  await client.listMarkets({marketId:id("a"),memeToken:address("b"),launchPhase:1,sort:"marketId_desc"});
  for (const args of [{launchPhase:2}, {launchPhase:0.5}, {sort:"latest"}, {limit:NaN}]) {
    await assert.rejects(client.listMarkets(args as never),TypeError);
  }
  assert.equal(calls,1);
});

test("candle client preserves exact range parameters and unavailable errors", async () => {
  let called = 0;
  const client = new TickerGardenV1Client("https://api.example.test", async (input) => {
    called++;
    const url = new URL(String(input));
    assert.equal(url.pathname, `/v1/markets/${id("1")}/candles`);
    assert.equal(url.searchParams.get("interval"), "1m");
    assert.equal(url.searchParams.get("from"), "60");
    assert.equal(url.searchParams.get("to"), "120");
    return new Response(JSON.stringify({error:"analytics_unavailable",message:"incomplete",requestId:"test"}), {status:503});
  });
  await assert.rejects(client.getMarketCandles({marketId:id("1"),interval:"1m",from:"60",to:"120"}), (e:unknown) => e instanceof TickerGardenApiError && e.status===503 && e.body.error==="analytics_unavailable");
  await assert.rejects(client.getMarketCandles({marketId:id("1"),interval:"1m",from:"060",to:"120"}), TypeError);
  assert.equal(called,1);
  const schemas=spec.components.schemas;
  assert.equal(schemas.CandlePrice.properties.numerator.type,"string");
  assert.deepEqual(schemas.Candle.properties.open.oneOf[1],{type:"null"});
  assert.equal(schemas.Candle.properties.internalQuoteVolumeRaw.type,"string");
  assert.equal(schemas.CandleSeries.properties.pricePopulation.const,"ALL_EXECUTIONS_INCLUDING_INTERNAL_CONVERSIONS");
});

test("trade client preserves paging scope and exposes restart-required errors", async () => {
  const calls: URL[]=[];
  const client=new TickerGardenV1Client("https://api.example.test",async input=>{
    calls.push(new URL(String(input)));
    return new Response(JSON.stringify({error:"trade_page_changed",message:"restart",requestId:"test"}),{status:409});
  });
  await assert.rejects(client.listMarketTrades({marketId:id("1"),from:"60",to:"120",limit:50,cursor:"opaque_cursor"}), (e:unknown)=>e instanceof TickerGardenApiError && e.status===409 && e.body.error==="trade_page_changed");
  assert.equal(calls[0]!.pathname,`/v1/markets/${id("1")}/trades`);
  assert.equal(calls[0]!.searchParams.get("cursor"),"opaque_cursor");
  assert.equal(calls[0]!.searchParams.get("limit"),"50");
  assert.equal(calls[0]!.searchParams.get("from"),"60");
  await assert.rejects(client.listMarketTrades({marketId:id("1"),from:"60",to:"120",limit:101}),TypeError);
  assert.equal(calls.length,1);
  const s=spec.components.schemas;
  assert.equal(s.TradeActivity.properties.quoteRaw.type,"string");
  assert.deepEqual(s.TradeActivity.properties.actor.oneOf[1],{type:"null"});
  assert.ok(s.TradeSource.required.includes("eventKey"));
  assert.equal(s.MarketTradesResponse.properties.items.maxItems,100);
});


test("asset statistics SDK preserves scope and unavailable errors", async () => {
 const calls: URL[]=[];
 const client=new TickerGardenV1Client("https://api.example.test",async input=>{
  calls.push(new URL(String(input)));
  return new Response(JSON.stringify({error:"analytics_unavailable",message:"incomplete",requestId:"test"}),{status:503});
 });
 await assert.rejects(client.getAssetStatistics({assetUid:id("1"),from:"60",to:"120"}), (e:unknown)=>e instanceof TickerGardenApiError && e.status===503 && e.body.error==="analytics_unavailable");
 assert.equal(calls[0]!.pathname,`/v1/assets/${id("1")}/statistics`);
 assert.equal(calls[0]!.searchParams.get("from"),"60");
 assert.equal(calls[0]!.searchParams.get("to"),"120");
 await assert.rejects(client.getAssetStatistics({assetUid:"0xbad",from:"60",to:"120"}),TypeError);
 assert.equal(calls.length,1);
 assert.equal(spec.components.schemas.AssetTradeStats.properties.quoteVolumeRaw.type,"string");
 assert.equal(spec.components.schemas.AssetStatisticsResponse.properties.displayOnly.const,true);
});


test("holder SDK binds pagination scope and exposes snapshot changes",async()=>{
 const calls:URL[]=[];
 const client=new TickerGardenV1Client("https://api.example.test",async input=>{calls.push(new URL(String(input)));return new Response(JSON.stringify({error:"holder_page_changed",message:"restart",requestId:"test"}),{status:409})});
 await assert.rejects(client.listMarketHolders({marketId:id("1"),limit:10,cursor:"opaque_cursor"}),(e:unknown)=>e instanceof TickerGardenApiError&&e.status===409&&e.body.error==="holder_page_changed");
 assert.equal(calls[0]!.pathname,`/v1/markets/${id("1")}/holders`);
 assert.equal(calls[0]!.searchParams.get("limit"),"10");
 assert.equal(calls[0]!.searchParams.get("cursor"),"opaque_cursor");
 await assert.rejects(client.listMarketHolders({marketId:id("1"),limit:101}),TypeError);
 assert.equal(calls.length,1);
 assert.equal(spec.components.schemas.HolderBalance.properties.balanceRaw.type,"string");
});


test("global statistics SDK preserves range and unavailable errors",async()=>{
 const calls:URL[]=[];const client=new TickerGardenV1Client("https://api.example.test",async input=>{calls.push(new URL(String(input)));return new Response(JSON.stringify({error:"analytics_unavailable",message:"incomplete",requestId:"test"}),{status:503})});
 await assert.rejects(client.getGlobalStatistics({from:"60",to:"120"}),(e:unknown)=>e instanceof TickerGardenApiError&&e.status===503);
 assert.equal(calls[0]!.pathname,"/v1/stats/overview");assert.equal(calls[0]!.searchParams.get("from"),"60");
 assert.deepEqual(spec.components.schemas.GlobalTradeGroup.properties.binding.enum,["registered_stock","unbound"]);
});


test("global flow series SDK transports aligned range parameters",async()=>{
 const calls:URL[]=[];const client=new TickerGardenV1Client("https://api.example.test",async input=>{calls.push(new URL(String(input)));return new Response(JSON.stringify({error:"analytics_unavailable",message:"incomplete",requestId:"test"}),{status:503})});
 await assert.rejects(client.getGlobalFlowSeries({interval:"1h",from:"3600",to:"7200"}),(e:unknown)=>e instanceof TickerGardenApiError&&e.status===503);
 assert.equal(calls[0]!.pathname,"/v1/stats/series");assert.equal(calls[0]!.searchParams.get("interval"),"1h");assert.equal(calls[0]!.searchParams.get("to"),"7200");
 assert.equal(spec.components.schemas.GlobalFlowSeriesResponse.properties.emptyPolicy.const,"ZERO_FLOW_NO_SYNTHETIC_EXECUTIONS");
 assert.equal(spec.components.schemas.GlobalFlowGroup.properties.marketCount,undefined);
});


test("global holders SDK requests unparameterized snapshot and exposes errors",async()=>{
 const calls:URL[]=[];const client=new TickerGardenV1Client("https://api.example.test",async input=>{calls.push(new URL(String(input)));return new Response(JSON.stringify({error:"analytics_unavailable",message:"incomplete",requestId:"test"}),{status:503})});
 await assert.rejects(client.getGlobalHolderCounts(),(e:unknown)=>e instanceof TickerGardenApiError&&e.status===503);assert.equal(calls[0]!.pathname,"/v1/stats/holders");assert.equal(calls[0]!.search,"");
 assert.equal(spec.components.schemas.GlobalHolderCountsResponse.properties.exclusionPolicy.const,"UNION_OF_KNOWN_PROTOCOL_ADDRESSES_V1");
});

test('market name and phase sorts are available through the generated SDK',async()=>{
 const seen:URL[]=[];
 const client=new TickerGardenV1Client('http://localhost:8790',async input=>{seen.push(new URL(String(input)));return new Response(JSON.stringify({items:[],nextCursor:null}));});
 for(const sort of ['name_asc','launchPhase_asc'] as const){await client.listMarkets({sort,limit:17});assert.equal(seen.at(-1)?.searchParams.get('sort'),sort);}
 const sortSchema=spec.paths['/v1/markets'].get.parameters.find((p:{name:string})=>p.name==='sort').schema;
 assert.ok(sortSchema.enum.includes('name_asc'));assert.ok(sortSchema.enum.includes('launchPhase_asc'));
});

test('transaction status SDK encodes the hash and retains unavailable errors',async()=>{
 let path='';const client=new TickerGardenV1Client('http://localhost:8790',async input=>{path=new URL(String(input)).pathname;return new Response(JSON.stringify({error:'transaction_unavailable',message:'unavailable',requestId:'test'}),{status:503});});
 await assert.rejects(client.getTransactionStatus({txHash:id('1')}),(e:unknown)=>e instanceof TickerGardenApiError&&e.status===503);
 assert.equal(path,`/v1/transactions/${id('1')}`);await assert.rejects(client.getTransactionStatus({txHash:'bad' as never}),TypeError);
});

test("account client requests asset-level principal with snapshot pagination",async()=>{
 let seen:URL|undefined;
 const client=new TickerGardenV1Client("https://example.test",async(input)=>{seen=new URL(String(input));return new Response(JSON.stringify({items:[],nextCursor:null,sync:{}}),{status:200});});
 await client.listUserAccounts({address:address("a"),limit:1,cursor:"next"});
 assert.equal(seen?.pathname,`/v1/users/${address("a")}/accounts`);
 assert.equal(seen?.searchParams.get("cursor"),"next");
 await assert.rejects(client.listUserAccounts({address:"0x12"}),/invalid address/);
});
