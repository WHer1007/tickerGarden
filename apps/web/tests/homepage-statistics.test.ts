import assert from "node:assert/strict";
import { test } from "node:test";
import home from "../src/pages/home.ts";
import stats from "../src/pages/stats.ts";

test("Stats exposes the current summary, staking, and fee panels", () => {
  assert.doesNotMatch(home.html, /data-stats-summary|Stats/);
  assert.match(stats.html, /data-stats-summary/);
  assert.match(stats.html, /data-stats-staking-values/);
  assert.match(stats.html, /Allocated in 24h/);
  assert.match(stats.html, /data-stat-fee-(?:creator|staker|holder|platform)/);
});
