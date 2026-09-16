import assert from "node:assert/strict";
import { test } from "node:test";
import { isRouteLink, PAGE_PATHS, resolveRoute } from "../src/routing/routes.ts";

const origin = "https://tickergarden.example";
const url = (path: string) => new URL(path, origin);

test("resolves all canonical routes and preserves query/hash", () => {
  for (const [page, pathname] of Object.entries(PAGE_PATHS)) {
    const hash = page === "rewards" ? "#other" : "#positions";
    const route = resolveRoute(url(`${pathname}?marketId=abc${hash}`));
    assert.equal(route.page, page);
    assert.equal(route.pathname, pathname);
    assert.equal(route.search, "?marketId=abc");
    assert.equal(route.hash, hash);
    assert.equal(route.href, `${pathname}?marketId=abc${hash}`);
  }
});

test("normalizes legacy html URLs and trailing slashes", () => {
  for (const legacy of ["/rewards", "/rewards/", "/rewards.html"]) {
    const route = resolveRoute(url(`${legacy}?marketId=abc#creator`));
    assert.equal(route.page, "rewards");
    assert.equal(route.href, "/claim?marketId=abc#creator");
    assert.equal(isRouteLink(url(legacy), origin), true);
  }
  for (const legacy of ["/market", "/market/", "/market.html", "/markets", "/markets/", "/markets.html"]) {
    const route = resolveRoute(url(`${legacy}?marketId=abc#positions`));
    assert.equal(route.page, "markets");
    assert.equal(route.href, "/explore?marketId=abc#positions");
    assert.equal(isRouteLink(url(legacy), origin), true);
  }
  for (const [page, pathname] of Object.entries(PAGE_PATHS)) {
    const legacy = pathname === "/" ? "/index.html" : `${pathname}.html`;
    assert.equal(resolveRoute(url(`${legacy}?x=1#tab`)).page, page);
    const trailing = pathname === "/" ? "/?x=1#tab" : `${pathname}///?x=1#tab`;
    assert.equal(resolveRoute(url(trailing)).pathname, pathname);
    assert.equal(resolveRoute(url(`${legacy}?x=1#tab`)).href, `${pathname}?x=1#tab`);
  }
});

test("has an isolated staking route and migrates legacy claim tabs", () => {
  const staking = resolveRoute(url("/stake?marketId=abc#positions"));
  assert.equal(staking.page, "staking");
  assert.equal(staking.pathname, "/stake");
  assert.equal(staking.href, "/stake?marketId=abc#positions");

  for (const hash of ["#positions", "#staker", "#activity"]) {
    const route = resolveRoute(url(`/claim?marketId=abc${hash}`));
    assert.equal(route.page, "staking");
    assert.equal(route.pathname, "/stake");
    assert.equal(route.search, "?marketId=abc");
    assert.equal(route.hash, hash);
    assert.equal(route.href, `/stake?marketId=abc${hash}`);
    assert.equal(isRouteLink(url(`/claim${hash}`), origin), true);
  }
  assert.equal(resolveRoute(url("/claim#other")).page, "rewards");
});

test("rejects unknown pages, prefix collisions, external links, and static assets", () => {
  for (const removedLegacyDocsRoute of ["/faq", "/faq/", "/faq.html"]) {
    assert.equal(resolveRoute(url(removedLegacyDocsRoute)).page, "not-found");
  }
  assert.equal(resolveRoute(url("/marketplace")).page, "not-found");
  assert.equal(resolveRoute(url("/explore-extra")).page, "not-found");
  assert.equal(isRouteLink(url("/explore-extra"), origin), true);
  assert.equal(isRouteLink(url("/assets/logo.png"), origin), false);
  assert.equal(isRouteLink(new URL("https://other.example/explore"), origin), false);
  assert.equal(isRouteLink(new URL("mailto:test@example.com"), origin), false);
  assert.equal(isRouteLink(new URL("javascript:void(0)"), origin), false);
});
