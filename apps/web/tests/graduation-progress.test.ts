import assert from "node:assert/strict";
import { test } from "node:test";
import { graduationProgress } from "../src/v1/graduationProgress.ts";

test("reports empty, half, and full collected quote progress", () => {
  assert.equal(graduationProgress(0n, 100n), 0);
  assert.equal(graduationProgress(50n, 100n), 50);
  assert.equal(graduationProgress(100n, 100n), 100);
});

test("clamps overfunded progress to 100 percent", () => {
  assert.equal(graduationProgress(125n, 100n), 100);
});

test("works with six and eighteen decimal quote amounts", () => {
  assert.equal(graduationProgress(1_500_000n, 3_000_000n), 50);
  assert.equal(graduationProgress(500_000_000_000_000_000n, 1_000_000_000_000_000_000n), 50);
});

test("handles huge bigint quote amounts", () => {
  const target = 10n ** 60n;
  assert.equal(graduationProgress(target / 4n, target), 25);
});

test("returns null for invalid collected quote or target", () => {
  assert.equal(graduationProgress(-1n, 100n), null);
  assert.equal(graduationProgress(0n, 0n), null);
  assert.equal(graduationProgress(10n, -1n), null);
});
