import assert from "node:assert/strict";
import { test } from "node:test";
import { decodeFunctionData, encodeFunctionData, type Address, type Hex } from "viem";
import {
  CONTINUOUS_HOLDER_REWARD_MODE,
  BATCHED_HOLDER_REWARD_MODE,
  HOLDER_REWARDS_DISTRIBUTOR_V1_ABI,
  isContinuousHolderRewardMode,
} from "../src/v1/features/continuousRewards.ts";

const distributor = "0x1111111111111111111111111111111111111111" as Address;
const marketId = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as Hex;

test("Holder distributor exposes reads only; users claim through FeeVault", () => {
 assert.equal(HOLDER_REWARDS_DISTRIBUTOR_V1_ABI.some(item => item.type==='function' && String(item.name)==='claim'), false);
});

test("detects only the fixed streaming reward mode", () => {
  assert.equal(isContinuousHolderRewardMode(CONTINUOUS_HOLDER_REWARD_MODE), true);
  assert.equal(isContinuousHolderRewardMode(BATCHED_HOLDER_REWARD_MODE), true);
  assert.equal(isContinuousHolderRewardMode("0x" + "00".repeat(32)), false);
  assert.equal(isContinuousHolderRewardMode(null), false);
});

test("old continuous approval cannot authorize the new batched release", async () => {
  const {parseV1RuntimeConfig, CONTINUOUS_HOLDER_RELEASE_APPROVAL, BATCHED_HOLDER_RELEASE_APPROVAL} = await import("../src/v1/runtimeConfig.ts");
  const old = parseV1RuntimeConfig({VITE_CONTINUOUS_HOLDER_RELEASE_APPROVAL: CONTINUOUS_HOLDER_RELEASE_APPROVAL});
  assert.deepEqual(old.continuousHolderModes, [CONTINUOUS_HOLDER_REWARD_MODE]);
  const next = parseV1RuntimeConfig({VITE_CONTINUOUS_HOLDER_RELEASE_APPROVAL: BATCHED_HOLDER_RELEASE_APPROVAL});
  assert.deepEqual(next.continuousHolderModes, [BATCHED_HOLDER_REWARD_MODE]);
  const both = parseV1RuntimeConfig({VITE_CONTINUOUS_HOLDER_RELEASE_APPROVAL: `${CONTINUOUS_HOLDER_RELEASE_APPROVAL},${BATCHED_HOLDER_RELEASE_APPROVAL}`});
  assert.deepEqual(both.continuousHolderModes, [CONTINUOUS_HOLDER_REWARD_MODE, BATCHED_HOLDER_REWARD_MODE]);
});

test("continuous release approval cannot reuse the legacy Merkle approval", async () => {
  const { parseV1RuntimeConfig, V1_TREASURY_RELEASE_APPROVAL, CONTINUOUS_HOLDER_RELEASE_APPROVAL } = await import("../src/v1/runtimeConfig.ts");
  assert.equal(parseV1RuntimeConfig({ VITE_V1_TREASURY_RELEASE_APPROVAL: V1_TREASURY_RELEASE_APPROVAL }).continuousHolderWrites.available, false);
  const next = parseV1RuntimeConfig({ VITE_CONTINUOUS_HOLDER_RELEASE_APPROVAL: CONTINUOUS_HOLDER_RELEASE_APPROVAL });
  assert.equal(next.continuousHolderWrites.available, true);
  assert.equal(next.treasuryWrites.available, false);
});

test("frontend reward calls and decoded tuple match compiled extension ABI", async () => {
  const { readFile } = await import("node:fs/promises");
  const manifest = JSON.parse(await readFile(new URL("../../../spec/v1_product_artifact_manifest.json", import.meta.url), "utf8"));
  const extension = manifest.extensionModules.find((value: { module: string }) => value.module === "HolderRewardsDistributorV1");
  assert.ok(extension);
  const clean = (value: any): any => {
    if (Array.isArray(value)) return value.map(clean);
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).filter(([key]) => key !== "internalType" && key !== "name").map(([key, item]) => [key, clean(item)]));
    return value;
  };
  for (const item of HOLDER_REWARDS_DISTRIBUTOR_V1_ABI) {
    const compiled = extension.abi.find((candidate: { name: string; type: string }) => candidate.name === item.name && candidate.type === item.type);
    assert.deepEqual(clean(item), clean(compiled), item.name);
  }
});

test("configurable Holder release requires its own approval", async () => {
  const { parseV1RuntimeConfig, BATCHED_HOLDER_RELEASE_APPROVAL, CONFIGURABLE_HOLDER_RELEASE_APPROVAL } = await import("../src/v1/runtimeConfig.ts");
  const { CONFIGURABLE_HOLDER_REWARD_MODE, isContinuousHolderRewardMode } = await import("../src/v1/features/continuousRewards.ts");
  assert.ok(isContinuousHolderRewardMode(CONFIGURABLE_HOLDER_REWARD_MODE));
  const legacy = parseV1RuntimeConfig({ VITE_CONTINUOUS_HOLDER_RELEASE_APPROVAL: BATCHED_HOLDER_RELEASE_APPROVAL });
  const current = parseV1RuntimeConfig({ VITE_CONTINUOUS_HOLDER_RELEASE_APPROVAL: CONFIGURABLE_HOLDER_RELEASE_APPROVAL });
  assert.ok(current.continuousHolderWrites.available);
  assert.ok(!legacy.continuousHolderModes.includes(CONFIGURABLE_HOLDER_REWARD_MODE));
});
