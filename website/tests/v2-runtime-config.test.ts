import assert from "node:assert/strict";
import { test } from "node:test";
import { parseV2RuntimeConfig } from "../src/v2/runtimeConfig.ts";

const validEnv = {
  VITE_V2_READ_API_URL: "https://api.example.test/",
  VITE_V2_FACTORY_ADDRESS: "0x1111111111111111111111111111111111111111",
  VITE_V2_LAUNCH_ROUTER_ADDRESS: "0x2222222222222222222222222222222222222222",
  VITE_V2_ALLOCATION_MANAGER_ADDRESS: "0x3333333333333333333333333333333333333333",
  VITE_V2_PROTOCOL_FEE_VAULT_ADDRESS: "0x4444444444444444444444444444444444444444",
} as const;

test("parses a complete V2 runtime configuration as an origin", () => {
  const result = parseV2RuntimeConfig(validEnv);
  assert.equal(result.available, true);
  if (!result.available) return;
  assert.equal(result.baseUrl, "https://api.example.test");
  assert.equal(result.factoryAddress, validEnv.VITE_V2_FACTORY_ADDRESS);
  assert.equal(result.launchRouterAddress, validEnv.VITE_V2_LAUNCH_ROUTER_ADDRESS);
  assert.equal(result.allocationManagerAddress, validEnv.VITE_V2_ALLOCATION_MANAGER_ADDRESS);
  assert.equal(result.protocolFeeVaultAddress, validEnv.VITE_V2_PROTOCOL_FEE_VAULT_ADDRESS);
  assert.equal(Object.isFrozen(result), true);
});

test("fails closed with reasons for missing settings", () => {
  const result = parseV2RuntimeConfig({});
  assert.equal(result.available, false);
  if (result.available) return;
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.reasons), true);
  assert.equal(result.reasons.length, 5);
  assert.ok(result.reasons.every((reason) => reason.includes("is missing")));
});

test("rejects non-http protocols", () => {
  const result = parseV2RuntimeConfig({ ...validEnv, VITE_V2_READ_API_URL: "ftp://api.example.test/v2" });
  assert.equal(result.available, false);
  if (result.available) return;
  assert.ok(result.reasons.some((reason) => reason.includes("VITE_V2_READ_API_URL")));
});

test("rejects uppercase, zero, malformed, and non-string addresses", () => {
  const result = parseV2RuntimeConfig({
    ...validEnv,
    VITE_V2_FACTORY_ADDRESS: "0xABCDEF1111111111111111111111111111111111",
    VITE_V2_LAUNCH_ROUTER_ADDRESS: "0x0000000000000000000000000000000000000000",
    VITE_V2_ALLOCATION_MANAGER_ADDRESS: "0x1234",
    VITE_V2_PROTOCOL_FEE_VAULT_ADDRESS: true,
  });
  assert.equal(result.available, false);
  if (result.available) return;
  assert.equal(result.reasons.length, 4);
  assert.ok(result.reasons.every((reason) => reason.includes("ADDRESS")));
});

test("accepts a localhost origin with a port", () => {
  const result = parseV2RuntimeConfig({ ...validEnv, VITE_V2_READ_API_URL: "http://localhost:8787/" });
  assert.equal(result.available, true);
  if (!result.available) return;
  assert.equal(result.baseUrl, "http://localhost:8787");
});

test("rejects paths, credentials, queries, and fragments because API routes are origin-rooted", () => {
  for (const url of [
    "http://localhost:8787/read",
    "https://user:secret@api.example.test/",
    "https://api.example.test/?tenant=one",
    "https://api.example.test/#read",
  ]) {
    const result = parseV2RuntimeConfig({ ...validEnv, VITE_V2_READ_API_URL: url });
    assert.equal(result.available, false, url);
    if (!result.available) assert.ok(result.reasons.some((reason) => reason.includes("origin URL")));
  }
});
