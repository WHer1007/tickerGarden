import assert from "node:assert/strict";
import { test } from "node:test";
import type { Address, Hex } from "viem";
import {
  buildCurveBuyRequest,
  buildCurveSellRequest,
  buildCreateMarketRequest,
  buildLaunchAndBuyRequests,
  deriveCreateMarketParams,
  previewCreateMarketParams,
  toCurveProgressViewModel,
  toCurveViewModel,
  type SelectedLaunchConfig,
} from "../src/v2/features/launch.ts";
import type { MarketDetailResponse } from "../src/v2/readApi.ts";
import {
  assertCanonicalFactoryBindings,
  assertCanonicalLaunchBindings,
  assertCanonicalMarketBinding,
} from "../src/v2/chainBindings.ts";

const h = (digit: string): Hex => `0x${digit.repeat(64)}` as Hex;
const a = (digit: string): Address => `0x${digit.repeat(40)}` as Address;
const config: SelectedLaunchConfig = {
  asset: { assetUid: h("1"), status: 1 },
  quote: { configId: h("2"), economicsHash: h("2"), quoteAsset: "0x0000000000000000000000000000000000000000", ponsBaselineId: h("3"), status: 1 },
  pons: { baselineId: h("3"), status: 1 },
  template: { templateId: h("5"), status: 1 },
  creatorRevenueBeneficiary: a("a"), name: "Garden", symbol: "GDN", metadataURI: "ipfs://garden", salt: h("6"),
};

function market(quoteAsset: Address = config.quote.quoteAsset): MarketDetailResponse {
  return {
    sync: { chainId: 4663, status: "synced", blockNumber: "10", blockHash: h("a"), finality: "finalized", headBlockNumber: "10", headBlockHash: h("a"), lagBlocks: "0", revision: `10:${h("a")}` },
    market: {
      marketId: h("7"), assetUid: h("1"), memeToken: a("b"), curve: a("c"), gauge: a("d"), quoteAsset,
      quoteAssetConfigId: h("2"), ponsBaselineId: h("3"), sourceVersion: 1, launchPhase: 0, marketStatus: 0,
      curveProgress: { realQuoteReserve: "11", sellableTokens: "22", reservedTokens: "33", accruedCurveFees: "44", readyToGraduate: false, sweptAt: null },
      poolId: null, poolKey: null,
      canonicalRoute: { router: a("e"), quoter: a("f"), hook: a("1"), launchLocker: a("2"), graduationExecutor: a("3"), curveTradingEnabled: true, poolTradingEnabled: false, sourceVersion: 1, launchPhase: 0, marketStatus: 0 },
      source: { chainId: 4663, blockNumber: "10", blockHash: h("a"), transactionHash: h("b"), transactionIndex: 0, logIndex: 0 },
    } as never,
  };
}

function chainMarket(response = market()) {
  return {
    market: {
      config: {
        assetUid: response.market.assetUid,
        ponsBaselineId: response.market.ponsBaselineId,
        quoteAssetConfigId: response.market.quoteAssetConfigId,
        memeToken: response.market.memeToken,
        curve: response.market.curve,
        gauge: response.market.gauge,
        quoteAsset: response.market.quoteAsset,
        graduatedHook: response.market.canonicalRoute.hook,
      },
      runtime: {
        poolId: response.market.poolId ?? h("0"), sourceVersion: response.market.sourceVersion,
        sweptAt: response.market.curveProgress.sweptAt === null ? 0n : BigInt(response.market.curveProgress.sweptAt),
        launchPhase: response.market.launchPhase, marketStatus: response.market.marketStatus,
      },
    },
    route: {
      poolKey: { currency0: response.market.quoteAsset, currency1: response.market.memeToken, fee: 0, tickSpacing: 60, hooks: response.market.canonicalRoute.hook },
      poolId: response.market.poolId ?? h("9"), swapRouter: response.market.canonicalRoute.router,
      quoter: response.market.canonicalRoute.quoter, hook: response.market.canonicalRoute.hook,
      quoteAsset: response.market.quoteAsset, memeToken: response.market.memeToken,
      gauge: response.market.gauge, curve: response.market.curve,
      launchLocker: response.market.canonicalRoute.launchLocker, sourceVersion: response.market.sourceVersion,
      launchPhase: response.market.launchPhase, marketStatus: response.market.marketStatus,
      curveTradingEnabled: response.market.canonicalRoute.curveTradingEnabled,
      poolTradingEnabled: response.market.canonicalRoute.poolTradingEnabled,
    },
  };
}

test("derives zero-economics draft and binds the Factory preview for native launch", async () => {
  const roots = assertCanonicalFactoryBindings(
    [a("1"), a("2"), a("3"), a("4"), a("5"), a("6"), a("7"), a("8")],
    { protocolFeeVault: a("6"), allocationManager: a("7"), launchRouter: a("8") },
  );
  assert.equal(roots.marketRegistry, a("5"));
  assert.throws(() => assertCanonicalFactoryBindings(
    [a("1"), a("2"), a("3"), a("4"), a("5"), a("6"), a("7"), a("8")],
    { protocolFeeVault: a("6"), allocationManager: a("7"), launchRouter: a("9") },
  ), /LaunchRouter.*drifted/);
  const launchRecords = {
    asset: { status: 1 },
    quote: { ponsBaselineId: h("3"), quoteAsset: config.quote.quoteAsset, economicsHash: h("2"), status: 1 },
    pons: { status: 1 }, template: { status: 1 },
  };
  assert.doesNotThrow(() => assertCanonicalLaunchBindings(config, launchRecords));
  assert.throws(() => assertCanonicalLaunchBindings(config, { ...launchRecords, quote: { ...launchRecords.quote, quoteAsset: a("9") } }), /Quote asset drifted/);
  const params = deriveCreateMarketParams(config);
  assert.equal(params.expectedEconomics, h("0"));
  let previewArg: ReturnType<typeof deriveCreateMarketParams> | undefined;
  const built = await buildLaunchAndBuyRequests({ router: a("9"), launchFee: 5n, quoteIn: 7n, minTokensOut: 2n, recipient: a("8"), config,
    previewMarketEconomics: async (draft) => { previewArg = draft; return h("4"); } });
  assert.equal(previewArg?.expectedEconomics, h("0"));
  assert.equal(built.params.expectedEconomics, h("4"));
  assert.equal(built.request.value, 12n);
  assert.equal(built.approval, undefined);
  assert.equal((built.request.args as readonly unknown[])[1], 7n);
});

test("builds direct Factory create request from preview-bound params", async () => {
  let previewArg: ReturnType<typeof deriveCreateMarketParams> | undefined;
  const built = await buildCreateMarketRequest({
    factory: a("9"),
    launchFee: 5n,
    config,
    previewMarketEconomics: async (draft) => {
      previewArg = draft;
      return h("4");
    },
  });
  assert.equal(previewArg?.expectedEconomics, h("0"));
  assert.equal(built.params.expectedEconomics, h("4"));
  assert.equal(built.request.address, a("9"));
  assert.equal(built.request.functionName, "createMarket");
  assert.equal(built.request.value, 5n);
  assert.deepEqual(built.request.args, [built.params]);
});

test("builds ERC20 launch approval and curve buy/sell approvals", async () => {
  const erc20 = { ...config, quote: { ...config.quote, quoteAsset: a("9") } };
  const launch = await buildLaunchAndBuyRequests({ router: a("8"), launchFee: 5n, quoteIn: 7n, minTokensOut: 2n, recipient: a("7"), config: erc20, previewMarketEconomics: async () => h("4") });
  assert.equal(launch.request.value, 5n);
  assert.equal(launch.approval?.functionName, "approve");
  const response = market(a("9"));
  const buy = buildCurveBuyRequest({ marketResponse: response, quoteIn: 3n, minTokensOut: 1n, recipient: a("8") });
  assert.equal(buy.request.value, undefined);
  assert.equal(buy.approval?.address, a("9"));
  const sell = buildCurveSellRequest({ marketResponse: response, tokensIn: 4n, minQuoteOut: 1n, recipient: a("8") });
  assert.equal(sell.approval.address, a("b"));
});

test("exposes real curve progress and fails closed on stale, inactive, and invalid inputs", () => {
  const canonical = chainMarket();
  assert.doesNotThrow(() => assertCanonicalMarketBinding(market().market, canonical.market, canonical.route));
  assert.throws(
    () => assertCanonicalMarketBinding(market().market, canonical.market, { ...canonical.route, curve: a("9") }),
    /route Curve drifted/,
  );
  const view = toCurveViewModel(market());
  assert.deepEqual({ real: view.realQuoteReserve, sellable: view.sellableTokens, reserved: view.reservedTokens, fees: view.accruedCurveFees }, { real: 11n, sellable: 22n, reserved: 33n, fees: 44n });
  assert.equal(view.partialRefundPossible, true);
  assert.throws(() => toCurveViewModel({ ...market(), sync: { ...market().sync, status: "lagging" } }), /synced/);
  assert.throws(() => toCurveViewModel({ ...market(), sync: { ...market().sync, chainId: 1 as never } }), /synced/);
  assert.throws(() => toCurveViewModel({ ...market(), market: { ...market().market, launchPhase: 1, canonicalRoute: { ...market().market.canonicalRoute, launchPhase: 1 } } }), /active, not-graduated/);
  assert.throws(() => toCurveViewModel({ ...market(), market: { ...market().market, canonicalRoute: { ...market().market.canonicalRoute, sourceVersion: 2 } } }), /lifecycle drift/);
  assert.throws(() => toCurveViewModel({ ...market(), market: { ...market().market, source: { ...market().market.source, blockNumber: "11" } } }), /newer than finalized/);
  assert.throws(() => toCurveViewModel({ ...market(), market: { ...market().market, source: { ...market().market.source, chainId: 1 as never } } }), /not canonical/);
  assert.throws(() => toCurveViewModel({ ...market(), market: { ...market().market, curveProgress: { ...market().market.curveProgress, realQuoteReserve: "-1" } } }), /non-negative/);
  assert.throws(() => toCurveViewModel({ ...market(), market: { ...market().market, curveProgress: { ...market().market.curveProgress, accruedCurveFees: "1.2" } } }), /non-negative/);
  assert.throws(() => buildCurveBuyRequest({ marketResponse: market(), quoteIn: 0n, minTokensOut: 1n, recipient: a("8") }), /positive/);
  assert.throws(() => deriveCreateMarketParams({ ...config, quote: { ...config.quote, status: 2 } }), /ACTIVE/);
  assert.throws(() => deriveCreateMarketParams({ ...config, quote: { ...config.quote, ponsBaselineId: h("9") } }), /mismatch/);
  assert.throws(() => deriveCreateMarketParams({ ...config, quote: { ...config.quote, economicsHash: h("9") } }), /economicsHash mismatch/);
  const graduated = {
    ...market(),
    market: {
      ...market().market,
      launchPhase: 2,
      canonicalRoute: { ...market().market.canonicalRoute, launchPhase: 2, curveTradingEnabled: false, poolTradingEnabled: true },
    },
  };
  assert.equal(toCurveProgressViewModel(graduated).curveTradingEnabled, false);
  assert.throws(() => buildCurveBuyRequest({ marketResponse: graduated, quoteIn: 1n, minTokensOut: 1n, recipient: a("8") }), /active, not-graduated/);
  assert.throws(() => buildCurveSellRequest({ marketResponse: market(), tokensIn: 1n, minQuoteOut: 1n, recipient: a("0") }), /cannot be zero/);
});

test("rejects zero, malformed, or throwing Factory economics previews", async () => {
  await assert.rejects(() => previewCreateMarketParams(config, async () => h("0")), /zero economics/);
  await assert.rejects(() => previewCreateMarketParams(config, async () => "0xBAD" as Hex), /canonical bytes32/);
  await assert.rejects(() => previewCreateMarketParams(config, async () => { throw new Error("preview unavailable"); }), /preview unavailable/);
});
