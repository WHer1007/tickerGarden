import assert from "node:assert/strict";
import { test } from "node:test";
import { applyV2Event, createIndexerState, reconcileAtTip } from "../src/index.ts";
import { address, event, id } from "./fixtures.ts";

test("reports Vault, Gauge, FeeVault, sourceVersion, and Pool drift at the indexed tip", () => {
  const state = createIndexerState();
  applyV2Event(state, event("MarketRegistered(bytes32,bytes32,address,address,address,uint32)", {
    marketId: id("20"), assetUid: id("21"), memeToken: address("2"), curve: address("3"), gauge: address("4"), sourceVersion: 1n,
  }, 10n, id("10"), 0, { observations: [
    { kind: "gaugePosition", key: `${address("a")}:${id("20")}`, value: { activeStock: 5n, pendingStock: 2n } },
    { kind: "vaultPosition", key: `${id("21")}:${address("a")}`, value: { deposited: 12n, allocated: 7n, free: 5n } },
    { kind: "liability", key: `${id("20")}:${address("5")}`, value: { total: 9n } },
    { kind: "poolKey", key: id("30"), value: { bindingState: "ACTIVE" } },
  ] }));

  const alerts = reconcileAtTip(state, [
    { kind: "vaultPrincipal", table: "stockPositions", key: `${id("21")}:${address("a")}`, field: "deposited", onchainValue: 13n },
    { kind: "sourceVersion", table: "markets", key: id("20"), field: "sourceVersion", onchainValue: 1n },
    { kind: "gaugePosition", table: "gaugePositions", key: `${address("a")}:${id("20")}`, field: "activeStock", onchainValue: 6n },
    { kind: "feeVaultLiability", table: "observations", key: `liability:${id("20")}:${address("5")}`, field: "total", onchainValue: 9n },
    { kind: "feeVaultLiability", table: "observations", key: `liability:${id("20")}:${address("5")}`, field: "total", onchainValue: 8n, comparison: "atLeast" },
    { kind: "poolBinding", table: "pools", key: id("30"), field: "bindingState", onchainValue: "DISABLED" },
  ]);
  assert.deepEqual(alerts.map(({ kind }) => kind), ["vaultPrincipal", "gaugePosition", "feeVaultLiability", "poolBinding"]);
  assert.equal(alerts[0]?.blockNumber, 10n);
  assert.equal(alerts[0]?.blockHash, id("10"));
});

test("fails closed when asked to reconcile an empty index", () => {
  assert.throws(() => reconcileAtTip(createIndexerState(), []), /empty V2 index/);
});
