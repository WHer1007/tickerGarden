import assert from "node:assert/strict";
import { test } from "node:test";
import { buildAllocate, buildCloseAllocation, buildClaimStaker, buildDeposit, buildDepositAndAllocate, buildDirectRageQuit, buildRageQuit, buildSettleRageQuitRewards, buildStockApproval, buildVaultView, buildWithdraw, PENDING_SECONDS, UNLOCK_SECONDS } from "../src/v1/features/vault.ts";
import { assertCanonicalAssetBinding } from "../src/v1/chainBindings.ts";

const a = (n: string) => `0x${n.padStart(40, "0")}` as `0x${string}`;
const h = (n: string) => `0x${n.padStart(64, "0")}` as `0x${string}`;
const source = { chainId: 4663, blockNumber: "1", blockHash: h("10"), transactionHash: h("11"), transactionIndex: 0, logIndex: 0 };
const market = { marketId: h("1"), assetUid: h("2"), memeToken: a("6"), gauge: a("7"), quoteAsset: a("8"), curve: a("9"), launchPhase: 2, source } as never;
const position = { marketId: h("1"), assetUid: h("2"), user: a("3"), free: "10", allocated: "7", pending: "3", active: "4", unlockAt: null, claimable: [{ asset: a("8"), amount: "5" }, { asset: a("6"), amount: "6" }], source } as never;
const asset = { status: 1, tokenDecimals: 18, minimumAllocation: 10_000n } as const;
const snapshot = { executionSpecId: "V1-EXEC-8", revision: `1:${h("10")}`, syncStatus: "synced" } as const;

test("vault view exposes threshold, timing, balances and dual claimables", () => {
  const view = buildVaultView(market, position, snapshot, asset, 100n);
  assert.equal(view.free, 10n); assert.equal(view.quoteClaimable, 5n); assert.equal(view.memeClaimable, 6n);
  assert.equal(view.pendingForSeconds, PENDING_SECONDS); assert.equal(view.unlockAfterSeconds, UNLOCK_SECONDS);
  assert.equal(view.minimumAllocationStock, 10_000n); assert.equal(view.allocationOpen, true);
});

test("builders use canonical targets and exact ABI argument order", () => {
  const vault = a("10"), manager = a("11"), fee = a("12"), token = a("13"), assetUid = h("2");
  assert.equal(buildStockApproval(token, vault, 2n).args?.[0], vault);
  assert.deepEqual(buildDeposit(vault, assetUid, 2n).args, [assetUid, 2n]); assert.deepEqual(buildWithdraw(vault, assetUid, 2n).args, [assetUid, 2n]);
  assert.deepEqual(buildAllocate(manager, h("1"), 2n).args, [h("1"), 2n]);
  assert.deepEqual(buildCloseAllocation(manager, h("1")).args, [h("1")]);
  assert.equal(buildRageQuit(manager, h("1")).address, manager);
  assert.deepEqual(buildRageQuit(manager, h("1")).args, [h("1")]);
  assert.equal(buildDirectRageQuit(vault, assetUid, h("1")).address, vault);
  assert.deepEqual(buildDirectRageQuit(vault, assetUid, h("1")).args, [assetUid, h("1")]);
  assert.deepEqual(buildSettleRageQuitRewards(manager, h("1"), a("3")).args, [h("1"), a("3")]);
  assert.deepEqual(buildDepositAndAllocate(manager, h("1"), 2n, 3n).args, [h("1"), 2n, 3n]);
  assert.deepEqual(buildClaimStaker(fee, h("1"), token).args, [h("1"), token]);
  assert.deepEqual(buildClaimStaker(fee, h("1"), a("0")).args, [h("1"), a("0")]);
});

test("fail closed on stale snapshots, identity drift and malformed IDs", () => {
  assert.throws(() => buildVaultView(market, position, { ...snapshot, syncStatus: "lagging" }, asset, 1n));
  assert.throws(() => buildVaultView(market, position, { ...snapshot, revision: "1" }, asset, 1n));
  assert.throws(() => buildVaultView(market, Object.assign({}, position, { marketId: h("9") }), snapshot, asset, 1n));
  assert.throws(() => buildAllocate(a("1"), "0xbad" as never, 1n));
  assert.throws(() => buildDeposit(a("0"), h("2"), 1n), /non-zero/);
  assert.throws(() => buildDeposit(a("1"), "0xbad" as never, 1n), /bytes32/);
});

test("accepts independently updated market and position facts within one reconciled tip", () => {
  const olderMarket = Object.assign({}, market, { source: { ...source, blockNumber: "1", blockHash: h("10"), transactionHash: h("11") } });
  const newerPosition = Object.assign({}, position, { source: { ...source, blockNumber: "2", blockHash: h("20"), transactionHash: h("21") } });
  const view = buildVaultView(olderMarket as never, newerPosition as never, { ...snapshot, revision: `3:${h("30")}` }, asset, 100n);
  assert.equal(view.allocated, 7n);
});

test("zero balances are valid and the reconciled Registry value determines the dynamic allocation minimum", () => {
  const assetConfig = {
    kind: "asset", id: h("2"), status: 1,
    values: { stockToken: a("4"), userStockVault: a("5"), tokenDecimals: 18, minimumAllocation: "10000000000000000000" }, source,
  } as const;
  assert.equal(assertCanonicalAssetBinding(assetConfig as never, { stockToken: a("4"), userStockVault: a("5"), tokenDecimals: 18, status: 1 }, 10_000_000_000_000_000_000n).userStockVault, a("5"));
  assert.throws(() => assertCanonicalAssetBinding(assetConfig as never, { stockToken: a("9"), userStockVault: a("5"), tokenDecimals: 18, status: 1 }, 10_000_000_000_000_000_000n), /STOCK token drifted/);
  assert.throws(() => assertCanonicalAssetBinding(assetConfig as never, { stockToken: a("4"), userStockVault: a("5"), tokenDecimals: 18, status: 1 }, 9_000n), /minimum allocation drifted/);
  const zero = Object.assign({}, position, { free: "0", allocated: "0", pending: "0", active: "0", claimable: [{ asset: a("8"), amount: "0" }, { asset: a("6"), amount: "0" }] });
  assert.equal(buildVaultView(market, zero as never, snapshot, { status: 1, tokenDecimals: 6, minimumAllocation: 500_000n }, 100n).minimumAllocationStock, 500_000n);
  assert.equal(buildVaultView(market, zero as never, snapshot, { status: 1, tokenDecimals: 18, minimumAllocation: 10_000_000_000_000_000_000n }, 100n).minimumAllocationStock, 10_000_000_000_000_000_000n);
  assert.equal(buildVaultView(market, zero as never, snapshot, { status: 1, tokenDecimals: 18, minimumAllocation: 414n }, 100n).minimumAllocationStock, 414n);
  assert.throws(() => buildVaultView(market, zero as never, snapshot, { status: 1, tokenDecimals: 18, minimumAllocation: 413n }, 100n), /asset context/);
  assert.throws(() => buildVaultView(market, zero as never, snapshot, { status: 1, tokenDecimals: 5, minimumAllocation: 414n }, 100n), /asset context/);
  assert.throws(() => buildVaultView(market, zero as never, snapshot, { status: 1, tokenDecimals: 19, minimumAllocation: 414n }, 100n), /asset context/);
});

test("unlock boundaries remain explicit", () => {
  const locked = Object.assign({}, position, { unlockAt: "100" });
  const lockedView = buildVaultView(market, locked as never, snapshot, asset, 99n);
  assert.equal(lockedView.canExit, true);
  assert.equal(lockedView.canRageQuit, true);
  assert.equal(lockedView.canClaim, false);
  assert.equal(buildVaultView(market, locked as never, snapshot, asset, 100n).canClose, true);
});

test("rage quit remains available across launch phases while principal is allocated", () => {
  for (const launchPhase of [0, 1, 2, 3]) {
    {
      const view = buildVaultView(
        Object.assign({}, market, { launchPhase }) as never,
        Object.assign({}, position, { unlockAt: "999999" }) as never,
        snapshot,
        { status: 3, tokenDecimals: 18, minimumAllocation: asset.minimumAllocation },
        100n,
      );
      assert.equal(view.canRageQuit, true, `rage quit must ignore launch phase ${launchPhase}`);
    }
  }
  const zero = Object.assign({}, position, { allocated: "0", pending: "0", active: "0" });
  assert.equal(buildVaultView(market, zero as never, snapshot, asset, 100n).canRageQuit, false);
});

test("paused and retired assets close exposure without removing unlocked exits", () => {
  const unlocked = Object.assign({}, position, { unlockAt: "100" });

  for (const status of [2, 3]) {
    const view = buildVaultView(market, unlocked as never, snapshot, { status, tokenDecimals: 18, minimumAllocation: asset.minimumAllocation }, 100n);
    assert.equal(view.allocationOpen, false, `asset status ${status} must block new allocation`);
    assert.equal(view.canClose, true, `asset status ${status} must preserve close`);
  }

});
