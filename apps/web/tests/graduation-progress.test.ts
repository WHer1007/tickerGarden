import assert from "node:assert/strict";
import { test } from "node:test";
import { graduationProgress } from "../src/v1/graduationProgress.ts";

test("reports empty, half, and full sold progress", () => {
  assert.equal(graduationProgress(100n, 20n, 80n), 0);
  assert.equal(graduationProgress(100n, 20n, 40n), 50);
  assert.equal(graduationProgress(100n, 20n, 0n), 100);
});

test("returns null for invalid inventory states", () => {
  assert.equal(graduationProgress(20n, 20n, 0n), null);
  assert.equal(graduationProgress(10n, 11n, 0n), null);
  assert.equal(graduationProgress(100n, 20n, -1n), null);
  assert.equal(graduationProgress(100n, 20n, 81n), null);
});
