import type { Address } from "viem";
import { v1Abis } from "../generated/abis.ts";
import { createContractWriteRequest, type ContractWriteRequest, type ReconciledSnapshot } from "../transaction.ts";
import type { MarketReadModel, UserPositionReadModel } from "../generated/read-api.ts";

const HEX32 = /^0x[0-9a-f]{64}$/;
const ADDRESS = /^0x[0-9a-f]{40}$/;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const MAX_UINT256 = (1n << 256n) - 1n;
export const PENDING_SECONDS = 30;
export const UNLOCK_SECONDS = 24 * 60 * 60;

export interface VaultViewModel {
  readonly free: bigint; readonly allocated: bigint; readonly pending: bigint; readonly active: bigint;
  readonly quoteClaimable: bigint; readonly memeClaimable: bigint;
  readonly pendingForSeconds: number; readonly unlockAfterSeconds: number;
  readonly allocationOpen: boolean; readonly canExit: boolean;
  readonly canClose: boolean;
  readonly canClaim: boolean; readonly canRageQuit: boolean;
  readonly minimumAllocationStock: bigint;
}
export interface StockAssetContext {
  readonly status: number;
  readonly tokenDecimals: number;
  readonly minimumAllocation: bigint;
  readonly stockToken?: Address;
  readonly userStockVault?: Address;
}
function bytes32(value: string): asserts value is `0x${string}` { if (!HEX32.test(value)) throw new TypeError("invalid bytes32"); }
function address(value: string): asserts value is Address { if (!ADDRESS.test(value) || value === ZERO_ADDRESS) throw new TypeError("invalid non-zero address"); }
function quoteAddress(value: string): asserts value is Address { if (!ADDRESS.test(value)) throw new TypeError("invalid address"); }
function positive(value: bigint): void { if (value <= 0n || value > MAX_UINT256) throw new TypeError("amount must be a positive uint256"); }
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
  if (snapshot.executionSpecId !== "V1-EXEC-9" || snapshot.syncStatus !== "synced" || !/^\d+:0x[0-9a-f]{64}$/.test(snapshot.revision)) throw new Error("snapshot is not reconciled");
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
  // canonical asset lifecycle states.
  if (
    asset.status < 1 || asset.status > 3 || !Number.isInteger(asset.status)
      || !Number.isInteger(asset.tokenDecimals) || asset.tokenDecimals < 6 || asset.tokenDecimals > 18
      || asset.minimumAllocation < 414n || asset.minimumAllocation > MAX_UINT256 || nowSeconds < 0n
  ) throw new TypeError("invalid asset context");
  if (asset.stockToken !== undefined) address(asset.stockToken);
  if (asset.userStockVault !== undefined) address(asset.userStockVault);
  const free = nonNegative(position.free), allocated = nonNegative(position.allocated), pending = nonNegative(position.pending), active = nonNegative(position.active);
  if (allocated !== pending + active) throw new Error("allocation ledger mismatch");
  const quote = position.claimable[0], meme = position.claimable[1]; quoteAddress(quote.asset); address(meme.asset); const quoteClaimable = nonNegative(quote.amount), memeClaimable = nonNegative(meme.amount);
  if (quote.asset.toLowerCase() !== market.quoteAsset.toLowerCase() || meme.asset.toLowerCase() !== market.memeToken.toLowerCase()) throw new Error("claimable asset mismatch");
  const unlockAt = position.unlockAt === null ? null : nonNegative(position.unlockAt);
  const unlocked = unlockAt !== null && nowSeconds >= unlockAt;
  const operationalMarket = market.launchPhase === 1;
  const minimum = asset.minimumAllocation;
  // Rage Quit is the user's principal escape hatch. It is deliberately
  // independent of launch phase, unlock time, and allocation minimums; those
  // controls govern normal exposure, not principal exit.
  const canRageQuit = allocated > 0n;
  const canClaim = allocated === 0n || unlocked;
  return { free, allocated, pending, active, quoteClaimable, memeClaimable, minimumAllocationStock: minimum,
    pendingForSeconds: PENDING_SECONDS, unlockAfterSeconds: UNLOCK_SECONDS,
    allocationOpen: asset.status === 1 && market.launchPhase === 1,
    canExit: canRageQuit || (allocated > 0n && operationalMarket && unlocked),
    canClose: allocated > 0n && operationalMarket && unlocked,
    canClaim, canRageQuit };
}

export function buildStockApproval(stockToken: Address, vault: Address, amount_: bigint): ContractWriteRequest {
  address(stockToken); address(vault); positive(amount_);
  return createContractWriteRequest({ abi: v1Abis.TickerMemeTokenV1, address: stockToken, functionName: "approve", args: [vault, amount_] } as never);
}
export function buildDeposit(vault: Address, assetUid: `0x${string}`, amount_: bigint) { address(vault); bytes32(assetUid); positive(amount_); return request(v1Abis.UserStockVault, vault, "depositStock", [assetUid, amount_]); }
export function buildWithdraw(vault: Address, assetUid: `0x${string}`, amount_: bigint) { address(vault); bytes32(assetUid); positive(amount_); return request(v1Abis.UserStockVault, vault, "withdrawFreeStock", [assetUid, amount_]); }
export function buildAllocate(manager: Address, marketId: `0x${string}`, amount_: bigint) { address(manager); bytes32(marketId); positive(amount_); return request(v1Abis.AllocationManager, manager, "allocate", [marketId, amount_]); }

export function buildCloseAllocation(manager: Address, marketId: `0x${string}`) { address(manager); bytes32(marketId); return request(v1Abis.AllocationManager, manager, "closeAllocation", [marketId]); }
export function buildRageQuit(manager: Address, marketId: `0x${string}`) { address(manager); bytes32(marketId); return request(v1Abis.AllocationManager, manager, "rageQuit", [marketId]); }
export function buildDirectRageQuit(vault: Address, assetUid: `0x${string}`, marketId: `0x${string}`) { address(vault); bytes32(assetUid); bytes32(marketId); return request(v1Abis.UserStockVault, vault, "rageQuit", [assetUid, marketId]); }
export function buildSettleRageQuitRewards(manager: Address, marketId: `0x${string}`, user: Address) { address(manager); bytes32(marketId); address(user); return request(v1Abis.AllocationManager, manager, "settleRageQuitRewards", [marketId, user]); }
export function buildDepositAndAllocate(manager: Address, marketId: `0x${string}`, deposit: bigint, allocation: bigint) { address(manager); bytes32(marketId); positive(deposit); positive(allocation); return request(v1Abis.AllocationManager, manager, "depositAndAllocate", [marketId, deposit, allocation]); }
export function buildClaimStaker(feeVault: Address, marketId: `0x${string}`, asset: Address) { address(feeVault); bytes32(marketId); quoteAddress(asset); return request(v1Abis.ProtocolFeeVault, feeVault, "claimStaker", [marketId, asset]); }
export const buildClaimQuote = buildClaimStaker;
export const buildClaimMeme = buildClaimStaker;
