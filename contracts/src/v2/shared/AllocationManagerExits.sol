// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {AssetView, IMemeStockGauge, IUserStockVault, MarketView, PositionView} from "../interfaces/IV2Protocol.sol";
import {AllocationManagerIncreases} from "./AllocationManagerIncreases.sol";

/// @notice Full-position normal and forfeiting exit paths for the final AllocationManager.
/// @dev V2-EXEC-5 deliberately has no partial-decrease or cross-market migration path.
abstract contract AllocationManagerExits is AllocationManagerIncreases {
    uint8 internal constant MARKET_STATUS_EMERGENCY_EXIT = 3;

    struct ExitContext {
        IUserStockVault vault;
        IMemeStockGauge gauge;
        bytes32 assetUid;
    }

    error PositionLockedUntil(uint64 unlockAt);
    error NoAllocationPosition(address user, bytes32 marketId);

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
        if (user == address(0) || user == address(this)) revert InvalidAllocationUser(user);
        ExitContext memory context = _exitContext(marketId);

        uint256 vaultPosition = context.vault.allocation(context.assetUid, user, marketId);
        if (vaultPosition == 0) revert NoAllocationPosition(user, marketId);
        if (_gaugePosition(context.gauge, user) != vaultPosition) revert AllocationLedgerMismatch();

        (principal, quoteForfeited, memeForfeited, redistributed) = context.gauge.rageQuit(user);
        if (principal != vaultPosition || _gaugePosition(context.gauge, user) != 0) {
            revert AllocationLedgerMismatch();
        }

        uint256 withdrawn = context.vault.rageQuitAllocation(context.assetUid, user, marketId);
        if (
            withdrawn != principal || context.vault.allocation(context.assetUid, user, marketId) != 0
                || _gaugePosition(context.gauge, user) != 0
        ) {
            revert AllocationLedgerMismatch();
        }
    }

    function _exitContext(bytes32 marketId) internal view returns (ExitContext memory context) {
        MarketView memory marketView;
        AssetView memory assetView;
        (marketView, assetView, context.vault, context.gauge) = _allocationComponents(marketId);
        if (
            marketView.runtime.launchPhase != LAUNCH_PHASE_POOL_CREATED
                || marketView.runtime.marketStatus >= MARKET_STATUS_EMERGENCY_EXIT
        ) {
            revert StockAllocationClosed(marketId);
        }
        context.assetUid = marketView.config.assetUid;
    }

    function _gaugePosition(IMemeStockGauge gauge, address user) internal view returns (uint256 amount) {
        PositionView memory position = gauge.positionOf(user);
        return position.activeAmount + position.pendingAmount;
    }
}
