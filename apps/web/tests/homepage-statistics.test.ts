import assert from "node:assert/strict";
import { test } from "node:test";
import home from "../src/pages/home.ts";
import stats from "../src/pages/stats.ts";

test("global execution statistics are available only on the Stats page", () => {
  assert.doesNotMatch(home.html, /data-global-statistics|Global execution statistics/);
  assert.match(stats.html, /data-global-statistics/);
});
