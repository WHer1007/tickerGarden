import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveMarketRelease, type MarketRelease } from "../src/v1/marketRelease.ts";

const a = (n: number) => `0x${n.toString(16).padStart(40, "0")}` as `0x${string}`;
const release: MarketRelease = { releaseId: "r1", chainId: 4663, factory: a(1), marketRegistry: a(2), hook: a(3), feeVault: a(4), creatorRegistry: a(5), holderDistributor: a(6), launchRouter: a(7), allocationManager: a(8) };

test("resolves by chain and observed factory, regardless of releaseId", () => {
  const result = resolveMarketRelease([{ ...release, releaseId: "arbitrary" }], { chainId: 4663, token: { factory: a(1) } });
  assert.equal(result.release.factory, a(1));
});

test("rejects unknown factories and duplicate factories on one chain", () => {
  assert.throws(() => resolveMarketRelease([release], { chainId: 4663, token: { factory: a(99) } }), /Unknown market release factory/);
  assert.throws(() => resolveMarketRelease([release, { ...release, releaseId: "r2" }], { chainId: 4663, token: { factory: a(1) } }), /Duplicate factory/);
});

test("rejects zero catalog addresses and cross-binding mismatches", () => {
  assert.throws(() => resolveMarketRelease([{ ...release, hook: a(0) }], { chainId: 4663, token: { factory: a(1) } }), /zero address/);
  assert.throws(() => resolveMarketRelease([release], { chainId: 4663, token: { factory: a(1) }, distributor: { marketRegistry: a(99) } }), /does not match/);
});

test("old and new factories keep independent claim and staking targets", () => {
  const newer = {...release, releaseId: "r2", factory: a(11), feeVault: a(14), holderDistributor: a(16), allocationManager: a(18)};
  const oldMarket = resolveMarketRelease([newer, release], {chainId: 4663, token: {factory: release.factory}}).release;
  const newMarket = resolveMarketRelease([newer, release], {chainId: 4663, token: {factory: newer.factory}}).release;
  assert.equal(oldMarket.feeVault, a(4)); assert.equal(oldMarket.holderDistributor, a(6)); assert.equal(oldMarket.allocationManager, a(8));
  assert.equal(newMarket.feeVault, a(14)); assert.equal(newMarket.holderDistributor, a(16)); assert.equal(newMarket.allocationManager, a(18));
  assert.throws(() => resolveMarketRelease([release], {chainId: 421614, token: {factory: release.factory}}));
});
