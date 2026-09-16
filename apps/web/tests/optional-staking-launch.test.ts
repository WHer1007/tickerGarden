import assert from "node:assert/strict";
import { test } from "node:test";
import { deriveCreateMarketParams, previewCreateMarketParams } from "../src/v1/features/launch.ts";
import type { SelectedLaunchConfig } from "../src/v1/features/launch.ts";
import type { Address, Hex } from "viem";

const h = (n: string): Hex => `0x${n.repeat(64)}` as Hex;
const a = (n: string): Address => `0x${n.repeat(40)}` as Address;
const zero = h("0");
const base = (stakingEnabled?: boolean, asset?: { assetUid: Hex; status: number }): SelectedLaunchConfig => ({
  ...(asset === undefined ? {} : { asset }),
  quote: { configId: h("2"), economicsHash: h("2"), quoteAsset: a("1"), tickerGardenBaselineId: h("3"), status: 1 },
  baseline: { baselineId: h("3"), status: 1 }, template: { templateId: h("4"), status: 1 },
  creatorRevenueBeneficiary: a("5"), name: "Test", symbol: "TEST", metadataURI: "ipfs://test", salt: h("6"), stakingEnabled,
});

test("disabled staking works without an asset and canonicalizes zero assetUid", () => {
  const params = deriveCreateMarketParams(base(false));
  assert.equal(params.stakingEnabled, false);
  assert.equal(params.assetUid, zero);
});

test("enabled staking requires an active asset", () => {
  assert.throws(() => deriveCreateMarketParams(base(true)), /asset is required/);
  assert.throws(() => deriveCreateMarketParams(base(true, { assetUid: zero, status: 1 })), /nonzero stock/);
  assert.throws(() => deriveCreateMarketParams(base(true, { assetUid: h("1"), status: 2 })), /asset must be ACTIVE/);
});

test("disabled staking rejects a nonzero asset", () => {
  assert.throws(() => deriveCreateMarketParams(base(false, { assetUid: h("1"), status: 1 })), /assetUid to be zero/);
});

test("economics preview preserves staking mode and zero asset identity", async () => {
  const params = await previewCreateMarketParams(base(false), async draft => {
    assert.equal(draft.stakingEnabled, false);
    assert.equal(draft.assetUid, zero);
    return h("e");
  });
  assert.equal(params.stakingEnabled, false);
  assert.equal(params.expectedEconomics, h("e"));
});
