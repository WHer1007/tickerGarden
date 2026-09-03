import assert from "node:assert/strict";
import { test } from "node:test";
import { encodeAbiParameters, encodeEventTopics, parseAbiParameters, type TransactionReceipt } from "viem";
import { buildAllocate, buildClaimRecovery, buildCloseAllocation, buildClaimStaker, buildDeposit, buildDepositAndAllocate, buildFinalizeRecoveryRoot, buildForceRelease, buildRageQuit, buildStockApproval, buildVaultView, buildWithdraw, hasCanonicalRecoveryClaim, PENDING_SECONDS, RECOVERY_CHALLENGE_SECONDS, UNLOCK_SECONDS, validateRecoveryRootState } from "../src/v2/features/vault.ts";
import { v2Abis } from "../src/v2/generated/abis.ts";
import { assertCanonicalAssetBinding } from "../src/v2/chainBindings.ts";

const a = (n: string) => `0x${n.padStart(40, "0")}` as `0x${string}`;
const h = (n: string) => `0x${n.padStart(64, "0")}` as `0x${string}`;
const source = { chainId: 4663, blockNumber: "1", blockHash: h("10"), transactionHash: h("11"), transactionIndex: 0, logIndex: 0 };
const market = { marketId: h("1"), assetUid: h("2"), memeToken: a("6"), gauge: a("7"), quoteAsset: a("8"), curve: a("9"), launchPhase: 2, marketStatus: 0, source } as never;
const position = { marketId: h("1"), assetUid: h("2"), user: a("3"), free: "10", allocated: "7", pending: "3", active: "4", unlockAt: null, claimable: [{ asset: a("8"), amount: "5" }, { asset: a("6"), amount: "6" }], source } as never;
const asset = { status: 1, tokenDecimals: 18, minimumAllocation: 10_000n } as const;
const snapshot = { executionSpecId: "V2-EXEC-5", revision: `1:${h("10")}`, syncStatus: "synced" } as const;

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
  assert.deepEqual(buildRageQuit(manager, h("1")).args, [h("1")]);
  assert.deepEqual(buildDepositAndAllocate(manager, h("1"), 2n, 3n).args, [h("1"), 2n, 3n]);
  assert.deepEqual(buildClaimStaker(fee, h("1"), token).args, [h("1"), token]);
  assert.deepEqual(buildClaimStaker(fee, h("1"), a("0")).args, [h("1"), a("0")]);
  assert.deepEqual(buildFinalizeRecoveryRoot(fee, h("1"), 2, a("0"), 3).args, [h("1"), 2, a("0"), 3]);
  assert.deepEqual(buildClaimRecovery(fee, h("1"), 2, token, 4n, [h("5")]).args, [h("1"), 2, token, 4n, [h("5")]]);
  assert.deepEqual(buildForceRelease(vault, assetUid, h("1")).args, [assetUid, h("1")]);
});

test("fail closed on stale snapshots, identity drift, malformed IDs and recipient force release", () => {
  assert.throws(() => buildVaultView(market, position, { ...snapshot, syncStatus: "lagging" }, asset, 1n));
  assert.throws(() => buildVaultView(market, position, { ...snapshot, revision: "1" }, asset, 1n));
  assert.throws(() => buildVaultView(market, Object.assign({}, position, { marketId: h("9") }), snapshot, asset, 1n));
  assert.throws(() => buildAllocate(a("1"), "0xbad" as never, 1n));
  assert.throws(() => buildForceRelease(a("1"), h("2"), h("1"), a("3") as never));
  assert.throws(() => buildDeposit(a("0"), h("2"), 1n), /non-zero/);
  assert.throws(() => buildDeposit(a("1"), "0xbad" as never, 1n), /bytes32/);
  assert.throws(() => buildClaimRecovery(a("1"), h("1"), 0, a("0"), 1n, []), /epoch/);
  assert.throws(() => buildClaimRecovery(a("1"), h("1"), 1, a("0"), 1n, ["0xbad" as never]), /bytes32/);
  assert.throws(() => buildFinalizeRecoveryRoot(a("1"), h("1"), 1, a("0"), 0), /nonce/);
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

test("unlock boundaries and paused, retired, emergency states are explicit", () => {
  const locked = Object.assign({}, position, { unlockAt: "100" });
  const lockedView = buildVaultView(market, locked as never, snapshot, asset, 99n);
  assert.equal(lockedView.canExit, true);
  assert.equal(lockedView.canRageQuit, true);
  assert.equal(lockedView.canClaim, false);
  assert.equal(buildVaultView(Object.assign({}, market, { marketStatus: 1 }) as never, locked as never, snapshot, asset, 100n).canClose, true);
  const emergency = buildVaultView(Object.assign({}, market, { marketStatus: 3 }) as never, locked as never, snapshot, asset, 0n);
  assert.equal(emergency.canForceRelease, true);
});

test("paused and retired assets close exposure without removing unlocked exits", () => {
  const unlocked = Object.assign({}, position, { unlockAt: "100" });

  for (const status of [2, 3]) {
    const view = buildVaultView(market, unlocked as never, snapshot, { status, tokenDecimals: 18, minimumAllocation: asset.minimumAllocation }, 100n);
    assert.equal(view.allocationOpen, false, `asset status ${status} must block new allocation`);
    assert.equal(view.canClose, true, `asset status ${status} must preserve close`);
    assert.equal(view.canForceRelease, false, `asset status ${status} alone is not emergency`);
  }

  const emergency = buildVaultView(
    Object.assign({}, market, { marketStatus: 3 }) as never,
    unlocked as never,
    snapshot,
    { status: 3, tokenDecimals: 18, minimumAllocation: asset.minimumAllocation },
    0n,
  );
  assert.equal(emergency.allocationOpen, false);
  assert.equal(emergency.canExit, true);
  assert.equal(emergency.canClose, false);
  assert.equal(emergency.canForceRelease, true);
});

test("recovery root lifecycle rejects wrong epochs, zero commitments, and future snapshots", () => {
  const stateHash = h("71");
  const pending = {
    root: h("72"), declaredTotal: 8n, claimedTotal: 0n, proposedAt: 100n,
    finalizableAt: 100n + RECOVERY_CHALLENGE_SECONDS, proposalNonce: 1, status: 1,
  };
  assert.doesNotThrow(() => validateRecoveryRootState(pending, 10n, 90n, stateHash, 100n));
  assert.doesNotThrow(() => validateRecoveryRootState({ ...pending, status: 2, claimedTotal: 3n }, 10n, 90n, stateHash, 100n));
  assert.doesNotThrow(() => validateRecoveryRootState({ root: h("0"), declaredTotal: 0n, claimedTotal: 0n, proposedAt: 0n, finalizableAt: 0n, proposalNonce: 0, status: 0 }, 0n, 90n, stateHash, 100n));
  assert.throws(() => validateRecoveryRootState({ ...pending, root: h("0") }, 10n, 90n, stateHash, 100n), /lifecycle/);
  assert.throws(() => validateRecoveryRootState({ ...pending, finalizableAt: pending.finalizableAt - 1n }, 10n, 90n, stateHash, 100n), /lifecycle/);
  assert.throws(() => validateRecoveryRootState(pending, 10n, 101n, stateHash, 100n), /invalid recovery state/);
  assert.throws(() => validateRecoveryRootState(pending, 10n, 90n, h("0"), 100n), /invalid recovery state/);
});

test("recovery claim confirmation binds FeeVault emitter and every claim domain field", () => {
  const feeVault = a("81"), user = a("82"), marketId = h("83"), feeAsset = a("84"), amount = 5n;
  const log = {
    address: feeVault,
    topics: encodeEventTopics({ abi: v2Abis.ProtocolFeeVault, eventName: "RecoveryClaimed", args: { marketId, recoveryEpoch: 2, feeAsset } }),
    data: encodeAbiParameters(parseAbiParameters("address user, uint256 amount"), [user, amount]),
  };
  const receipt = { logs: [log] } as unknown as Pick<TransactionReceipt, "logs">;
  assert.equal(hasCanonicalRecoveryClaim(receipt, feeVault, { marketId, epoch: 2, feeAsset, user, amount }), true);
  assert.equal(hasCanonicalRecoveryClaim(receipt, a("85"), { marketId, epoch: 2, feeAsset, user, amount }), false);
  assert.equal(hasCanonicalRecoveryClaim(receipt, feeVault, { marketId, epoch: 3, feeAsset, user, amount }), false);
  assert.equal(hasCanonicalRecoveryClaim(receipt, feeVault, { marketId, epoch: 2, feeAsset, user, amount: 6n }), false);
});
