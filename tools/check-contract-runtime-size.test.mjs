import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { checkRuntimeSize, EIP170_LIMIT, MODULE_BUDGETS } from "./check-contract-runtime-size.mjs";

test("accepts under and exact budgets", () => {
  assert.equal(checkRuntimeSize(MODULE_BUDGETS.Factory - 1, MODULE_BUDGETS.Factory).headroom, 1);
  assert.equal(checkRuntimeSize(MODULE_BUDGETS.Factory, MODULE_BUDGETS.Factory).headroom, 0);
});
test("rejects over budget and EIP-170", () => {
  assert.throws(() => checkRuntimeSize(MODULE_BUDGETS.FeeVault + 1, MODULE_BUDGETS.FeeVault), /exceeds budget/);
  assert.throws(() => checkRuntimeSize(EIP170_LIMIT + 1), /EIP-170/);
});
test("rejects invalid data", () => {
  for (const value of [0, -1, 1.5, NaN, "12", null]) assert.throws(() => checkRuntimeSize(value), /positive integer/);
});
test("CLI checks current artifacts", () => {
  const result = spawnSync(process.execPath, ["tools/check-contract-runtime-size.mjs"], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Factory: .*headroom/);
  assert.match(result.stdout, /FeeVault: .*headroom/);
});
