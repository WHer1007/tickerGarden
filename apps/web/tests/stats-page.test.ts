import assert from "node:assert/strict";
import { test } from "node:test";
import stats from "../src/pages/stats.ts";

test("Stats exposes business metrics and explicit analytics periods", () => {
  assert.match(stats.html, /data-stats-period="24h">24h/);
  assert.match(stats.html, /data-stats-period="all">All time/);
  assert.match(stats.html, /24h trading volume \(USD\)/);
  assert.match(stats.html, /Token launches in 24h/);
  assert.match(stats.html, /Bloomed markets/);
  assert.match(stats.html, /Current holder addresses/);
  assert.match(stats.html, /Missing or stale price coverage is shown as unavailable instead of zero/);
  assert.doesNotMatch(stats.html, /Protocol total not exposed|No USD TVL/);
});
