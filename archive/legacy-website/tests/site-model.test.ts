import assert from "node:assert/strict";
import test from "node:test";
import { filterMarkets, marketHref, parseSiteRoute, routeIsActive, summarizeMarkets, type MarketLike } from "../src/site/model.ts";

function h(char: string): string {
  return `0x${char.repeat(64)}`;
}

function market(overrides: Partial<MarketLike> = {}): MarketLike {
  return {
    marketId: h("1"),
    assetUid: h("a"),
    memeToken: `0x${"2".repeat(40)}`,
    quoteAsset: `0x${"3".repeat(40)}`,
    launchPhase: 0,
    curveProgress: { realQuoteReserve: "100", accruedCurveFees: "3", readyToGraduate: false },
    source: { blockNumber: "10" },
    ...overrides,
  };
}

test("maps every public product URL and keeps market deep links active", () => {
  assert.deepEqual(parseSiteRoute("/"), { name: "home" });
  assert.deepEqual(parseSiteRoute("/create/"), { name: "create" });
  assert.deepEqual(parseSiteRoute("/markets"), { name: "markets" });
  assert.deepEqual(parseSiteRoute(`/markets/${h("f")}`), { name: "market", marketId: h("f") });
  assert.deepEqual(parseSiteRoute("/portfolio"), { name: "portfolio" });
  assert.deepEqual(parseSiteRoute("/stats"), { name: "stats" });
  assert.deepEqual(parseSiteRoute("/faq"), { name: "faq" });
  assert.deepEqual(parseSiteRoute("/outside"), { name: "not-found", pathname: "/outside" });
  assert.equal(routeIsActive(parseSiteRoute(`/markets/${h("f")}`), "markets"), true);
  assert.equal(marketHref(h("f")), `/markets/${h("f")}`);
});

test("filters markets by canonical identity, lifecycle and STOCK context", () => {
  const first = market();
  const second = market({ marketId: h("2"), assetUid: h("b"), launchPhase: 2, source: { blockNumber: "12" } });
  const third = market({ marketId: h("3"), memeToken: `0x${"9".repeat(40)}`, launchPhase: 0, source: { blockNumber: "11" } });
  const items = [first, second, third];

  assert.deepEqual(filterMarkets(items, { phase: "0" }).map((item) => item.marketId), [third.marketId, first.marketId]);
  assert.deepEqual(filterMarkets(items, { assetUid: h("b") }).map((item) => item.marketId), [second.marketId]);
  assert.deepEqual(filterMarkets(items, { search: "999999" }).map((item) => item.marketId), [third.marketId]);
  assert.deepEqual(filterMarkets(items, { order: "oldest" }).map((item) => item.marketId), [first.marketId, third.marketId, second.marketId]);
});

test("aggregates lifecycle counts while keeping unlike Quote assets separate", () => {
  const quoteA = `0x${"3".repeat(40)}`;
  const quoteB = `0x${"4".repeat(40)}`;
  const summary = summarizeMarkets([
    market({ quoteAsset: quoteA, curveProgress: { realQuoteReserve: "100", accruedCurveFees: "3", readyToGraduate: true } }),
    market({ marketId: h("2"), quoteAsset: quoteA, launchPhase: 2, curveProgress: { realQuoteReserve: "50", accruedCurveFees: "2", readyToGraduate: false } }),
    market({ marketId: h("3"), quoteAsset: quoteB, launchPhase: 3, curveProgress: { realQuoteReserve: "7", accruedCurveFees: "1", readyToGraduate: false } }),
  ]);

  assert.equal(summary.total, 3);
  assert.deepEqual(summary.phaseCounts, [1, 0, 1, 1]);
  assert.equal(summary.readyToGraduate, 1);
  assert.deepEqual(summary.quoteGroups, [
    { quoteAsset: quoteA, markets: 2, realQuoteReserve: 150n, accruedCurveFees: 5n },
    { quoteAsset: quoteB, markets: 1, realQuoteReserve: 7n, accruedCurveFees: 1n },
  ]);
});
