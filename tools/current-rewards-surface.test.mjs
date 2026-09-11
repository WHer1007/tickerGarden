import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("../", import.meta.url);

function source(relativePath) {
  return readFileSync(new URL(relativePath, root), "utf8");
}

function assertSymbolsAbsent(relativePath, symbols) {
  const text = source(relativePath);
  for (const symbol of symbols) {
    assert.equal(
      text.includes(symbol),
      false,
      `${relativePath} must not contain ${symbol}`,
    );
  }
}

test("web rewards surface has no removed raw reward exit helpers", () => {
  assertSymbolsAbsent("apps/web/src/app.ts", [
    "buildClaimCreator",
    "buildClaimStaker",
    "requestRawRewardExit",
    "cancelRawRewardExit",
    "rawRewardExitAt",
    "rawExitReady",
    "rawExitStatus",
  ]);
});

test("holder rewards worker has no settlement implementation", () => {
  assertSymbolsAbsent("tools/holder-rewards/worker.mjs", [
    "settlementOperator",
    "settleHolderRewards",
    "beneficiaryConversions",
    "treasuryDistributor",
  ]);
});

test("root scripts have no removed treasury lifecycle entries", () => {
  const packageJson = JSON.parse(source("package.json"));
  const scripts = packageJson.scripts ?? {};
  for (const name of ["root-generator", "treasury-worker", "treasury-lifecycle"]) {
    assert.equal(JSON.stringify(scripts).includes(name), false, `root script ${name} must be absent`);
  }
});

test("Go reward positions have no raw reward exit fields", () => {
  assertSymbolsAbsent("services/backend-go/internal/rewards/positions.go", [
    "rawRewardExitAt",
    "rawRewardExitReady",
  ]);
});


test("retired reward observer and activation scripts cannot be invoked", () => {
  for (const path of [
    "services/backend-go/internal/deployment/reward_conversion_state.go",
    "services/backend-go/internal/settlement",
    "services/backend-go/cmd/settlement-worker",
    "services/backend-go/cmd/settlement-executor",
    "services/backend-go/cmd/treasury-worker",
    "services/backend-go/cmd/treasury-lifecycle",
    "services/backend-go/cmd/treasury-jobs",
    "services/backend-go/cmd/treasury-review",
    "services/backend-go/internal/httpapi/treasury.go",
    "services/backend-go/internal/projector/conversions.go",
    "tools/activate-arbitrum-release.mjs",
    "tools/activate-arbitrum-continuous.mjs",
    "tools/configure-robinhood-testnet-settlement-operator.mjs",
  ]) assert.equal(existsSync(new URL(path, root)), false, `${path} must be retired`);
});
