// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {AssetView, IMemeStockGauge, IUserStockVault, MarketView, PositionView} from "../interfaces/IV1Protocol.sol";
import {AllocationManagerIncreases} from "./AllocationManagerIncreases.sol";

/// @notice Full-position normal and forfeiting exit paths for the final AllocationManager.
/// @dev V1-EXEC-6 deliberately has no partial-decrease or cross-market migration path.
abstract contract AllocationManagerExits is AllocationManagerIncreases {
    uint256 private constant RAGE_QUIT_GAUGE_GAS_LIMIT = 1_000_000;
    uint256 private constant RAGE_QUIT_GAUGE_VIEW_GAS_LIMIT = 250_000;
    uint256 private constant RAGE_QUIT_COMPLETION_GAS_RESERVE = 350_000;

    struct ExitContext {
        IUserStockVault vault;
        IMemeStockGauge gauge;
        bytes32 assetUid;
    }

    error PositionLockedUntil(uint64 unlockAt);
    error NoAllocationPosition(address user, bytes32 marketId);
    error NoRageQuitRewardSettlement(address user, bytes32 marketId);

    constructor(address officialStockRegistry_, address marketRegistry_)
        AllocationManagerIncreases(officialStockRegistry_, marketRegistry_)
    {}

    function _closeAllocation(address user, bytes32 marketId) internal nonReentrant {
        if (user == address(0) || user == address(this)) revert InvalidAllocationUser(user);

        ExitContext memory context = _exitContext(marketId);
        uint256 vaultPosition = context.vault.allocation(context.assetUid, user, marketId);
        PositionView memory gaugePosition = context.gauge.positionOf(user);
        uint256 gaugeAmount = gaugePosition.activeAmount + gaugePosition.pendingAmount;
        if (gaugeAmount != vaultPosition) revert AllocationLedgerMismatch();
        if (vaultPosition == 0) revert NoAllocationPosition(user, marketId);
        if (block.timestamp < gaugePosition.unlockAt) revert PositionLockedUntil(gaugePosition.unlockAt);

        uint256 removed = context.gauge.removeAllocation(user);
        if (removed != vaultPosition || _gaugePosition(context.gauge, user) != 0) {
            revert AllocationLedgerMismatch();
        }

        uint256 released = context.vault.releaseAllocation(context.assetUid, user, marketId);
        if (released != vaultPosition || context.vault.allocation(context.assetUid, user, marketId) != 0) {
            revert AllocationLedgerMismatch();
        }
    }

    function _rageQuitAllocation(address user, bytes32 marketId)
        internal
        nonReentrant
        returns (uint256 principal, uint256 quoteForfeited, uint256 memeForfeited, bool redistributed)
    {
        (principal, quoteForfeited, memeForfeited, redistributed,,) = _rageQuitAllocationWithSettlement(user, marketId);
    }

    function _rageQuitAllocationWithSettlement(address user, bytes32 marketId)
        internal
        returns (
            uint256 principal,
            uint256 quoteForfeited,
            uint256 memeForfeited,
            bool redistributed,
            bool rewardSettlementCompleted,
            address gaugeAddress
        )
    {
        if (user == address(0) || user == address(this)) revert InvalidAllocationUser(user);

        // The Vault is the authoritative principal ledger. It clears the user's allocation, records a reward
        // forfeiture tombstone and transfers the complete STOCK principal before any Gauge interaction.
        ExitContext memory context = _rageQuitContext(marketId);
        gaugeAddress = address(context.gauge);
        principal = context.vault.allocation(context.assetUid, user, marketId);
        if (principal == 0) revert NoAllocationPosition(user, marketId);

        uint256 withdrawn = context.vault.rageQuitAllocation(context.assetUid, user, marketId);
        if (withdrawn != principal || context.vault.allocation(context.assetUid, user, marketId) != 0) {
            revert AllocationLedgerMismatch();
        }

        // Reward cleanup is best-effort and gas-bounded. Any Gauge failure leaves the Vault tombstone in place,
        // which blocks stale claims and same-market re-entry but can never roll back the completed principal exit.
        (quoteForfeited, memeForfeited, redistributed, rewardSettlementCompleted) =
            _tryCompleteRageQuitRewards(context, user, marketId, principal);
    }

    function _settleRageQuitRewards(address user, bytes32 marketId)
        internal
        nonReentrant
        returns (uint256 principal, uint256 quoteForfeited, uint256 memeForfeited, bool redistributed)
    {
        if (user == address(0) || user == address(this)) revert InvalidAllocationUser(user);

        ExitContext memory context = _rageQuitContext(marketId);
        principal = context.vault.rageQuitSettlementPrincipal(context.assetUid, user, marketId);
        if (principal == 0) revert NoRageQuitRewardSettlement(user, marketId);

        PositionView memory beforePosition = context.gauge.positionOf(user);
        uint256 gaugePrincipal = beforePosition.activeAmount + beforePosition.pendingAmount;
        if (gaugePrincipal == 0) {
            if (beforePosition.quoteClaimable != 0 || beforePosition.memeClaimable != 0) {
                revert AllocationLedgerMismatch();
            }
        } else {
            if (gaugePrincipal != principal) revert AllocationLedgerMismatch();
            uint256 forfeitedPrincipal;
            (forfeitedPrincipal, quoteForfeited, memeForfeited, redistributed) = context.gauge.rageQuit(user);
            if (forfeitedPrincipal != principal) revert AllocationLedgerMismatch();

            PositionView memory afterPosition = context.gauge.positionOf(user);
            if (
                afterPosition.activeAmount != 0 || afterPosition.pendingAmount != 0 || afterPosition.quoteClaimable != 0
                    || afterPosition.memeClaimable != 0
            ) {
                revert AllocationLedgerMismatch();
            }
        }

        uint256 completedPrincipal = context.vault.completeRageQuitRewardSettlement(context.assetUid, user, marketId);
        if (completedPrincipal != principal) revert AllocationLedgerMismatch();
    }

    function _rageQuitSettlementPending(address user, bytes32 marketId)
        internal
        view
        returns (bool pending, uint256 principal)
    {
        ExitContext memory context = _rageQuitContext(marketId);
        principal = context.vault.rageQuitSettlementPrincipal(context.assetUid, user, marketId);
        pending = principal != 0;
    }

    function _exitContext(bytes32 marketId) internal view returns (ExitContext memory context) {
        MarketView memory marketView;
        AssetView memory assetView;
        (marketView, assetView, context.vault, context.gauge) = _allocationComponents(marketId);
        if (marketView.runtime.launchPhase != LAUNCH_PHASE_POOL_CREATED) {
            revert StockAllocationClosed(marketId);
        }
        context.assetUid = marketView.config.assetUid;
    }

    /// @dev Resolves only the write-once market-to-asset-to-Vault identity required for principal escape. Market
    ///      phase, asset operational status, position lock, minimum allocation and Gauge liveness are not
    ///      principal withdrawal gates.
    function _rageQuitContext(bytes32 marketId) private view returns (ExitContext memory context) {
        if (marketId == bytes32(0)) revert StockAllocationClosed(marketId);

        MarketView memory marketView = _marketRegistry.market(marketId);
        AssetView memory assetView = _officialStockRegistry.asset(marketView.config.assetUid);
        if (
            assetView.status == 0 || assetView.status > 3 || assetView.tokenDecimals < 6 || assetView.tokenDecimals > 18
                || assetView.stockToken.code.length == 0 || assetView.userStockVault.code.length == 0
                || assetView.stockToken == assetView.userStockVault
        ) {
            revert InvalidAllocationComponents(marketId, assetView.userStockVault, marketView.config.gauge);
        }

        context.vault = IUserStockVault(assetView.userStockVault);
        context.gauge = IMemeStockGauge(marketView.config.gauge);
        context.assetUid = marketView.config.assetUid;
    }

    function _tryCompleteRageQuitRewards(ExitContext memory context, address user, bytes32 marketId, uint256 principal)
        private
        returns (uint256 quoteForfeited, uint256 memeForfeited, bool redistributed, bool completed)
    {
        if (
            address(context.gauge).code.length == 0
                || gasleft() <= RAGE_QUIT_GAUGE_GAS_LIMIT + RAGE_QUIT_COMPLETION_GAS_RESERVE
        ) {
            return (0, 0, false, false);
        }

        try context.gauge.rageQuit{gas: RAGE_QUIT_GAUGE_GAS_LIMIT}(user) returns (
            uint256 forfeitedPrincipal, uint256 forfeitedQuote, uint256 forfeitedMeme, bool didRedistribute
        ) {
            if (forfeitedPrincipal != principal) return (0, 0, false, false);

            try context.gauge.positionOf{gas: RAGE_QUIT_GAUGE_VIEW_GAS_LIMIT}(user) returns (
                PositionView memory position
            ) {
                if (
                    position.activeAmount != 0 || position.pendingAmount != 0 || position.quoteClaimable != 0
                        || position.memeClaimable != 0
                ) {
                    return (0, 0, false, false);
                }

                try context.vault.completeRageQuitRewardSettlement(context.assetUid, user, marketId) returns (
                    uint256 completedPrincipal
                ) {
                    if (completedPrincipal != principal) return (0, 0, false, false);
                    return (forfeitedQuote, forfeitedMeme, didRedistribute, true);
                } catch {
                    return (0, 0, false, false);
                }
            } catch {
                return (0, 0, false, false);
            }
        } catch {
            return (0, 0, false, false);
        }
    }

    function _gaugePosition(IMemeStockGauge gauge, address user) internal view returns (uint256 amount) {
        PositionView memory position = gauge.positionOf(user);
        return position.activeAmount + position.pendingAmount;
    }
}
