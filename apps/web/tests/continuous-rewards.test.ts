import assert from "node:assert/strict";
import { test } from "node:test";
import { decodeFunctionData, encodeFunctionData, type Address, type Hex } from "viem";
import {
  buildContinuousHolderClaim,
  CONTINUOUS_HOLDER_REWARD_MODE,
  HOLDER_REWARDS_DISTRIBUTOR_V1_ABI,
  isContinuousHolderRewardMode,
} from "../src/v1/features/continuousRewards.ts";

const distributor = "0x1111111111111111111111111111111111111111" as Address;
const marketId = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as Hex;

test("builds single-argument continuous holder claim calldata", () => {
  const request = buildContinuousHolderClaim({ distributor, marketId });
  const data = encodeFunctionData({ abi: HOLDER_REWARDS_DISTRIBUTOR_V1_ABI, functionName: "claim", args: request.args as [Hex] });
  const decoded = decodeFunctionData({ abi: HOLDER_REWARDS_DISTRIBUTOR_V1_ABI, data });
  assert.equal(decoded.functionName, "claim");
  assert.deepEqual(decoded.args, [marketId]);
  assert.deepEqual(request.args, [marketId]);
});

test("rejects invalid distributor and market identifiers", () => {
  assert.throws(() => buildContinuousHolderClaim({ distributor: "0x0" as Address, marketId }), /distributor|address/);
  assert.throws(() => buildContinuousHolderClaim({ distributor, marketId: "0x0" as Hex }), /marketId|bytes32/);
  assert.throws(() => buildContinuousHolderClaim({ distributor, marketId: `0x${"0".repeat(64)}` as Hex }), /marketId|bytes32/);
});

test("detects only the fixed streaming reward mode", () => {
  assert.equal(isContinuousHolderRewardMode(CONTINUOUS_HOLDER_REWARD_MODE), true);
  assert.equal(isContinuousHolderRewardMode("0x" + "00".repeat(32)), false);
  assert.equal(isContinuousHolderRewardMode(null), false);
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
