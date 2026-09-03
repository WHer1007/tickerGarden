import { decodeEventLog, type Address, type TransactionReceipt } from "viem";
import { v2Abis } from "../generated/abis.ts";
import { createContractWriteRequest, type ContractWriteRequest, type ReconciledSnapshot } from "../transaction.ts";
import type { MarketReadModel, UserPositionReadModel } from "../generated/read-api.ts";

const HEX32 = /^0x[0-9a-f]{64}$/;
const ADDRESS = /^0x[0-9a-f]{40}$/;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const ZERO_HEX32 = `0x${"0".repeat(64)}`;
const MAX_UINT256 = (1n << 256n) - 1n;
const MAX_UINT64 = (1n << 64n) - 1n;
export const PENDING_SECONDS = 30;
export const UNLOCK_SECONDS = 24 * 60 * 60;
export const RECOVERY_CHALLENGE_SECONDS = 2n * 24n * 60n * 60n;

export interface VaultViewModel {
  readonly free: bigint; readonly allocated: bigint; readonly pending: bigint; readonly active: bigint;
  readonly quoteClaimable: bigint; readonly memeClaimable: bigint;
  readonly pendingForSeconds: number; readonly unlockAfterSeconds: number;
  readonly allocationOpen: boolean; readonly canExit: boolean;
  readonly canDecrease: boolean; readonly canClose: boolean; readonly canMigrate: boolean; readonly canForceRelease: boolean;
  readonly minimumAllocationStock: bigint;
}
export interface StockAssetContext { readonly status: number; readonly tokenDecimals: number; readonly stockToken?: Address; readonly userStockVault?: Address; }
export interface RecoveryRootState {
  readonly root: string; readonly declaredTotal: bigint; readonly claimedTotal: bigint;
  readonly proposedAt: bigint; readonly finalizableAt: bigint; readonly proposalNonce: number; readonly status: number;
}

function bytes32(value: string): asserts value is `0x${string}` { if (!HEX32.test(value)) throw new TypeError("invalid bytes32"); }
function address(value: string): asserts value is Address { if (!ADDRESS.test(value) || value === ZERO_ADDRESS) throw new TypeError("invalid non-zero address"); }
function quoteAddress(value: string): asserts value is Address { if (!ADDRESS.test(value)) throw new TypeError("invalid address"); }
function positive(value: bigint): void { if (value <= 0n || value > MAX_UINT256) throw new TypeError("amount must be a positive uint256"); }
function epoch(value: number): void { if (!Number.isInteger(value) || value < 1 || value > 0xffff_ffff) throw new TypeError("recovery epoch must be a positive uint32"); }
function nonNegative(value: string): bigint { if (!/^\d+$/.test(value)) throw new TypeError("invalid integer amount"); return BigInt(value); }
function source(source_: MarketReadModel["source"], reconciledBlock: bigint): void {
  if (
    source_.chainId !== 4663 || !/^\d+$/.test(source_.blockNumber) || !HEX32.test(source_.blockHash)
      || !HEX32.test(source_.transactionHash) || !Number.isSafeInteger(source_.transactionIndex)
      || source_.transactionIndex < 0 || !Number.isSafeInteger(source_.logIndex) || source_.logIndex < 0
      || BigInt(source_.blockNumber) > reconciledBlock
  ) throw new Error("invalid or future source identity");
}
function context(market: MarketReadModel, position: UserPositionReadModel, snapshot: ReconciledSnapshot) {
  bytes32(market.marketId); bytes32(position.marketId); bytes32(position.assetUid);
  address(market.memeToken); address(market.gauge); quoteAddress(market.quoteAsset); address(market.curve);
  if (market.marketId !== position.marketId || market.assetUid !== position.assetUid) throw new Error("position market identity mismatch");
  if (snapshot.executionSpecId !== "V2-EXEC-3" || snapshot.syncStatus !== "synced" || !/^\d+:0x[0-9a-f]{64}$/.test(snapshot.revision)) throw new Error("snapshot is not reconciled");
  address(position.user);
  const reconciledBlock = snapshot.revision.split(":")[0] ?? "";
  if (!/^\d+$/.test(reconciledBlock)) throw new Error("invalid reconciled snapshot revision");
  source(market.source, BigInt(reconciledBlock));
  source(position.source, BigInt(reconciledBlock));
}
function amount(value: string): bigint { const result = nonNegative(value); positive(result); return result; }
function request(abi: readonly unknown[], address_: Address, name: string, args: readonly unknown[]): ContractWriteRequest {
  return createContractWriteRequest({ abi, address: address_, functionName: name as never, args: args as never });
}

export function buildVaultView(market: MarketReadModel, position: UserPositionReadModel, snapshot: ReconciledSnapshot, asset: StockAssetContext, nowSeconds: bigint): VaultViewModel {
  context(market, position, snapshot);
  // Pausing or retiring an official STOCK must stop new exposure without
  // hiding a user's existing principal-exit path. Statuses 1..3 are the
  // canonical Active/Paused/Retired lifecycle states.
  if (asset.status < 1 || asset.status > 3 || !Number.isInteger(asset.status) || !Number.isInteger(asset.tokenDecimals) || asset.tokenDecimals < 6 || asset.tokenDecimals > 18 || nowSeconds < 0n) throw new TypeError("invalid asset context");
  if (asset.stockToken !== undefined) address(asset.stockToken);
  if (asset.userStockVault !== undefined) address(asset.userStockVault);
  const free = nonNegative(position.free), allocated = nonNegative(position.allocated), pending = nonNegative(position.pending), active = nonNegative(position.active);
  if (allocated !== pending + active) throw new Error("allocation ledger mismatch");
  const quote = position.claimable[0], meme = position.claimable[1]; quoteAddress(quote.asset); address(meme.asset); const quoteClaimable = nonNegative(quote.amount), memeClaimable = nonNegative(meme.amount);
  if (quote.asset.toLowerCase() !== market.quoteAsset.toLowerCase() || meme.asset.toLowerCase() !== market.memeToken.toLowerCase()) throw new Error("claimable asset mismatch");
  const unlockAt = position.unlockAt === null ? null : nonNegative(position.unlockAt);
  const emergency = market.marketStatus === 3;
  const unlocked = unlockAt !== null && nowSeconds >= unlockAt;
  const minimum = 5n * 10n ** BigInt(asset.tokenDecimals - 1) + 1n;
  return { free, allocated, pending, active, quoteClaimable, memeClaimable, minimumAllocationStock: minimum,
    pendingForSeconds: PENDING_SECONDS, unlockAfterSeconds: UNLOCK_SECONDS,
    allocationOpen: asset.status === 1 && market.launchPhase === 2 && market.marketStatus === 0,
    canExit: allocated > 0n && market.launchPhase === 2 && (emergency || unlocked), canDecrease: allocated > 0n && !emergency && market.launchPhase === 2 && unlocked, canClose: allocated > 0n && !emergency && market.launchPhase === 2 && unlocked,
    canMigrate: allocated > 0n && !emergency && market.launchPhase === 2 && unlocked, canForceRelease: allocated > 0n && emergency };
}

export function buildStockApproval(stockToken: Address, vault: Address, amount_: bigint): ContractWriteRequest {
  address(stockToken); address(vault); positive(amount_);
  return createContractWriteRequest({ abi: v2Abis.TickerMemeTokenV2, address: stockToken, functionName: "approve", args: [vault, amount_] } as never);
}
export function buildDeposit(vault: Address, assetUid: `0x${string}`, amount_: bigint) { address(vault); bytes32(assetUid); positive(amount_); return request(v2Abis.UserStockVault, vault, "depositStock", [assetUid, amount_]); }
export function buildWithdraw(vault: Address, assetUid: `0x${string}`, amount_: bigint) { address(vault); bytes32(assetUid); positive(amount_); return request(v2Abis.UserStockVault, vault, "withdrawFreeStock", [assetUid, amount_]); }
export function buildAllocate(manager: Address, marketId: `0x${string}`, amount_: bigint) { address(manager); bytes32(marketId); positive(amount_); return request(v2Abis.AllocationManager, manager, "allocate", [marketId, amount_]); }
export function buildIncreaseAllocation(manager: Address, marketId: `0x${string}`, amount_: bigint) { address(manager); bytes32(marketId); positive(amount_); return request(v2Abis.AllocationManager, manager, "increaseAllocation", [marketId, amount_]); }
export function buildDecreaseAllocation(manager: Address, marketId: `0x${string}`, amount_: bigint) { address(manager); bytes32(marketId); positive(amount_); return request(v2Abis.AllocationManager, manager, "decreaseAllocation", [marketId, amount_]); }
export function buildCloseAllocation(manager: Address, marketId: `0x${string}`) { address(manager); bytes32(marketId); return request(v2Abis.AllocationManager, manager, "closeAllocation", [marketId]); }
export function buildMigrateAllocation(manager: Address, from: `0x${string}`, to: `0x${string}`, amount_: bigint) { address(manager); bytes32(from); bytes32(to); positive(amount_); return request(v2Abis.AllocationManager, manager, "migrateAllocation", [from, to, amount_]); }
export function buildDepositAndAllocate(manager: Address, marketId: `0x${string}`, deposit: bigint, allocation: bigint) { address(manager); bytes32(marketId); positive(deposit); positive(allocation); return request(v2Abis.AllocationManager, manager, "depositAndAllocate", [marketId, deposit, allocation]); }
export function buildClaimStaker(feeVault: Address, marketId: `0x${string}`, asset: Address) { address(feeVault); bytes32(marketId); quoteAddress(asset); return request(v2Abis.ProtocolFeeVault, feeVault, "claimStaker", [marketId, asset]); }
export const buildClaimQuote = buildClaimStaker;
export const buildClaimMeme = buildClaimStaker;
export function buildFinalizeRecoveryRoot(feeVault: Address, marketId: `0x${string}`, recoveryEpoch: number, asset: Address, proposalNonce: number) {
  address(feeVault); bytes32(marketId); epoch(recoveryEpoch); quoteAddress(asset);
  if (!Number.isInteger(proposalNonce) || proposalNonce < 1 || proposalNonce > 0xffff_ffff) throw new TypeError("proposal nonce must be a positive uint32");
  return request(v2Abis.ProtocolFeeVault, feeVault, "finalizeRecoveryRoot", [marketId, recoveryEpoch, asset, proposalNonce]);
}
export function buildClaimRecovery(feeVault: Address, marketId: `0x${string}`, recoveryEpoch: number, asset: Address, amount_: bigint, proof: readonly `0x${string}`[]) {
  address(feeVault); bytes32(marketId); epoch(recoveryEpoch); quoteAddress(asset); positive(amount_);
  if (!Array.isArray(proof) || proof.length > 64) throw new TypeError("recovery proof must contain at most 64 nodes");
  proof.forEach(bytes32);
  return request(v2Abis.ProtocolFeeVault, feeVault, "claimRecovery", [marketId, recoveryEpoch, asset, amount_, proof]);
}
export function validateRecoveryRootState(
  view: RecoveryRootState,
  cap: bigint,
  snapshotBlock: bigint,
  stateHash: string,
  reconciledBlock: bigint,
): void {
  if (
    !HEX32.test(view.root) || !HEX32.test(stateHash) || stateHash === ZERO_HEX32
      || cap < 0n || cap > MAX_UINT256 || snapshotBlock < 0n || snapshotBlock > MAX_UINT64
      || reconciledBlock < 0n || snapshotBlock > reconciledBlock
      || view.declaredTotal < 0n || view.declaredTotal > MAX_UINT256
      || view.claimedTotal < 0n || view.claimedTotal > view.declaredTotal || view.declaredTotal > cap
      || view.proposedAt < 0n || view.proposedAt > MAX_UINT64
      || view.finalizableAt < 0n || view.finalizableAt > MAX_UINT64
      || !Number.isInteger(view.status) || view.status < 0 || view.status > 3
      || !Number.isInteger(view.proposalNonce) || view.proposalNonce < 0 || view.proposalNonce > 0xffff_ffff
  ) throw new Error("ProtocolFeeVault returned an invalid recovery state");
  if (view.status === 0) {
    if (
      view.root !== ZERO_HEX32 || view.declaredTotal !== 0n || view.claimedTotal !== 0n
        || view.proposedAt !== 0n || view.finalizableAt !== 0n || view.proposalNonce !== 0
    ) throw new Error("ProtocolFeeVault returned an invalid empty recovery root");
    return;
  }
  if (
    view.root === ZERO_HEX32 || view.declaredTotal === 0n || view.proposalNonce === 0 || view.proposedAt === 0n
      || view.finalizableAt !== view.proposedAt + RECOVERY_CHALLENGE_SECONDS
      || ((view.status === 1 || view.status === 3) && view.claimedTotal !== 0n)
  ) throw new Error("ProtocolFeeVault returned an inconsistent recovery root lifecycle");
}

export function hasCanonicalRecoveryClaim(
  receipt: Pick<TransactionReceipt, "logs">,
  feeVault: Address,
  expected: Readonly<{ marketId: `0x${string}`; epoch: number; feeAsset: Address; user: Address; amount: bigint }>,
): boolean {
  address(feeVault); bytes32(expected.marketId); epoch(expected.epoch); quoteAddress(expected.feeAsset); address(expected.user); positive(expected.amount);
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== feeVault.toLowerCase()) continue;
    try {
      const decoded = decodeEventLog({ abi: v2Abis.ProtocolFeeVault, data: log.data, topics: log.topics });
      if (
        decoded.eventName === "RecoveryClaimed"
          && decoded.args.marketId.toLowerCase() === expected.marketId
          && Number(decoded.args.recoveryEpoch) === expected.epoch
          && decoded.args.feeAsset.toLowerCase() === expected.feeAsset
          && decoded.args.user.toLowerCase() === expected.user
          && decoded.args.amount === expected.amount
      ) return true;
    } catch {
      // Ignore unrelated logs emitted by the FeeVault in the same transaction.
    }
  }
  return false;
}
export function buildForceRelease(vault: Address, assetUid: `0x${string}`, marketId: `0x${string}`, recipient?: never) { address(vault); bytes32(assetUid); bytes32(marketId); if (recipient !== undefined) throw new TypeError("recipient is not permitted"); return request(v2Abis.UserStockVault, vault, "forceReleaseAllocation", [assetUid, marketId]); }
