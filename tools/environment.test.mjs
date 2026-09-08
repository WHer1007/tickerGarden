import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { checkSource, policies, readProjectEnv, serviceEnvironment, validateEnvironment } from "./environment.mjs";

function environment(profile = "test") {
  const p = policies[profile];
  return {
    TG_PROFILE: profile,
    TG_CHAIN_ID: p.chain,
    VITE_V1_CHAIN_ID: p.chain,
    V1_EXPECTED_CHAIN_ID: p.chain,
    TG_EXPECTED_EPOCH_SECONDS: p.epoch,
    TG_EXPECTED_ALLOCATION_LOCK_SECONDS: "86400",
    TG_EXPECTED_POSITION_LOCK_SECONDS: "86400",
    TG_EXPECTED_UNPAUSE_SECONDS: "86400",
    TG_EXPECTED_RAW_EXIT_SECONDS: "604800",
    TG_EXPECTED_ANTI_SNIPE_SECONDS: profile === "test" ? "5" : "3",
    V1_NATIVE_PHANTOM_WEI: p.phantom,
    V1_NATIVE_GRADUATION_WEI: p.graduation,
    V1_FINALITY_DELAY_SECONDS: "600",
    V1_FINALITY_DELAY_BLOCKS: "2",
    V1_ROOT_PUBLICATION_WINDOW: "86400",
    V1_ROOT_REVIEW_DELAY: "3600",
    V1_CLAIM_WINDOW: "2592000",
    ...(profile === "test" ? { TG_EVENT_READ_MODE: "on-demand", TG_EVENT_START_POLICY: "latest-on-first-request" } : {}),
  };
}

test("rejects branch/profile mismatch while allowing codex test branches", () => {
  assert.throws(() => validateEnvironment("master", environment("master"), "codex/feature"), /cannot use master/);
  assert.doesNotThrow(() => validateEnvironment("test", environment(), "codex/feature"));
  assert.throws(() => validateEnvironment("test", environment(), "master"), /cannot use test/);
});

test("rejects chain, amount, and clock drift", () => {
  for (const key of ["TG_CHAIN_ID", "VITE_V1_CHAIN_ID", "V1_NATIVE_PHANTOM_WEI", "V1_NATIVE_GRADUATION_WEI", "TG_EXPECTED_EPOCH_SECONDS", "TG_EXPECTED_RAW_EXIT_SECONDS", "TG_EXPECTED_ANTI_SNIPE_SECONDS"]) {
    const values = environment();
    values[key] = "synthetic-drift";
    assert.throws(() => validateEnvironment("test", values, "test"), new RegExp(`Wrong test parameter: ${key}`));
  }
});

test("rejects secret-looking public VITE variables and oversized gateway CU budgets", () => {
  const secret = environment();
  secret.VITE_SERVICE_API_KEY = "synthetic-secret";
  assert.throws(() => validateEnvironment("test", secret, "test"), /Secret-looking variable/);
  for (const value of ["10001", "0", "not-a-number"]) {
    const values = environment();
    values.TG_RPC_CU_PER_SECOND = value;
    assert.throws(() => validateEnvironment("test", values, "test"), /RPC CU budget/);
  }
});

test("rejects test bootstrap in master configuration", () => {
  const values = environment("master");
  values.VITE_INTEGRATION_BOOTSTRAP = "synthetic-bootstrap.json";
  assert.throws(() => validateEnvironment("master", values, "master"), /Master cannot use test integration bootstrap/);
});

test("service environments isolate credentials and shell profile pollution", () => {
  const values = { ...environment(), VITE_PUBLIC_FLAG: "yes", TG_CONTENT_ONLY: "content", PINATA_API_KEY: "file-secret", API_KEY: "server-secret" };
  const inherited = { PATH: "/synthetic/bin", TG_PROFILE: "master", TG_EVIL: "shell-tg", VITE_EVIL: "shell-vite", PINATA_API_KEY: "shell-secret", API_KEY: "shell-api" };
  const web = serviceEnvironment(values, "web", inherited);
  assert.equal(web.VITE_PUBLIC_FLAG, "yes");
  assert.equal(web.TG_PROFILE, "test");
  assert.equal(web.TG_CONTENT_ONLY, undefined);
  assert.equal(web.PINATA_API_KEY, undefined);
  assert.equal(web.VITE_EVIL, undefined);
  assert.equal(web.TG_EVIL, undefined);
  const api = serviceEnvironment(values, "api", inherited);
  assert.equal(api.API_KEY, undefined);
  assert.equal(api.PINATA_API_KEY, undefined);
  assert.equal(api.VITE_PUBLIC_FLAG, undefined);
  assert.equal(api.TG_PROFILE, "test");
  const content = serviceEnvironment(values, "content-worker", inherited);
  assert.equal(content.PINATA_API_KEY, "file-secret");
  assert.equal(content.TG_CONTENT_ONLY, "content");
  assert.equal(content.PINATA_API_KEY, "file-secret");
  assert.equal(content.TG_PROFILE, "test");
  const gateway = serviceEnvironment({ ...values, RH46630_API_KEY: "gateway-secret", TG_GATEWAY_CONFIG_JSON: "gateway-config", TG_RPC_CU_PER_SECOND: "100" }, "gateway", inherited);
  assert.equal(gateway.RH46630_API_KEY, "gateway-secret");
  assert.equal(gateway.TG_GATEWAY_CONFIG_JSON, "gateway-config");
  assert.equal(gateway.TG_RPC_CU_PER_SECOND, "100");
  assert.equal(gateway.PINATA_API_KEY, undefined);
  assert.equal(gateway.API_KEY, undefined);
  assert.equal(gateway.TG_CONTENT_ONLY, undefined);
});

test("readProjectEnv requires mode 0600 and does not read real secrets", () => {
  const temp = mkdtempSync(path.join(os.tmpdir(), "tickergarden-env-test-"));
  const file = path.join(temp, ".env.test.local");
  writeFileSync(file, Object.entries(environment()).map(([k, v]) => `${k}=${v}`).join("\n"));
  chmodSync(file, 0o644);
  assert.throws(() => readProjectEnv("test", { root: temp, branch: "test" }), /mode 0600/);
  chmodSync(file, 0o600);
  assert.equal(readProjectEnv("test", { root: temp, branch: "test" }).TG_CHAIN_ID, "46630");
  assert.equal(statSync(file).mode & 0o777, 0o600);
});

test("source checks reject drift without mutating source files", () => {
  const temp = mkdtempSync(path.join(os.tmpdir(), "tickergarden-source-test-"));
  for (const file of ["contracts/src/v1/modules/TreasuryDistributorV1.sol", "contracts/src/v1/shared/AllocationManagerIncreases.sol", "contracts/src/v1/shared/MemeStockGaugePendingPositions.sol", "contracts/src/v1/shared/DelayedUnpause.sol", "contracts/src/v1/shared/ProtocolFeeVaultRewardSettlement.sol"]) {
    const full = path.join(temp, file);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, file.includes("Treasury") ? "EPOCH_DURATION = 7 days" : file.includes("Allocation") ? "MINIMUM_LOCK = 24 hours" : file.includes("Pending") ? "MINIMUM_POSITION_LOCK = 24 hours" : file.includes("Unpause") ? "UNPAUSE_STATE_DELAY = 1 days" : "RAW_EXIT_DELAY = 7 days");
  }
  const before = readFileSync(path.join(temp, "contracts/src/v1/modules/TreasuryDistributorV1.sol"), "utf8");
  assert.throws(() => checkSource({ ...environment(), TG_EXPECTED_EPOCH_SECONDS: "1209600" }, temp), /Treasury epoch differs/);
  assert.equal(readFileSync(path.join(temp, "contracts/src/v1/modules/TreasuryDistributorV1.sol"), "utf8"), before);
});
