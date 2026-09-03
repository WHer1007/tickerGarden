// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {AssetView, IMemeStockGauge, IUserStockVault, MarketView, PositionView} from "../interfaces/IV2Protocol.sol";
import {AllocationManagerIncreases} from "./AllocationManagerIncreases.sol";

/// @notice Shared decrease/close path for the final AllocationManager.
abstract contract AllocationManagerDecreases is AllocationManagerIncreases {
    uint8 internal constant MARKET_STATUS_EMERGENCY_EXIT = 3;

    struct ExitContext {
        IUserStockVault vault;
        IMemeStockGauge gauge;
        bytes32 assetUid;
        uint256 minimumAllocation;
    }

    error PositionLockedUntil(uint64 unlockAt);
    error InsufficientAllocation(uint256 requested, uint256 available);
    error NoAllocationPosition(address user, bytes32 marketId);

    constructor(address officialStockRegistry_, address marketRegistry_)
        AllocationManagerIncreases(officialStockRegistry_, marketRegistry_)
    {}

    function _decreaseAllocation(address user, bytes32 marketId, uint256 requestedAmount, bool closePosition)
        internal
        nonReentrant
    {
        if (user == address(0) || user == address(this)) revert InvalidAllocationUser(user);
        if (!closePosition && requestedAmount == 0) revert InvalidAllocationAmount(requestedAmount);

        ExitContext memory context = _exitContext(marketId);

        context.gauge.checkpointActivations();
        context.gauge.settle(user);

        PositionView memory position = context.gauge.positionOf(user);
        uint256 currentPosition = position.activeAmount + position.pendingAmount;
        if (currentPosition != context.vault.allocation(context.assetUid, user, marketId)) {
            revert AllocationLedgerMismatch();
        }
        if (currentPosition == 0) revert NoAllocationPosition(user, marketId);
        if (block.timestamp < position.unlockAt) revert PositionLockedUntil(position.unlockAt);

        uint256 amount = closePosition ? currentPosition : requestedAmount;
        if (amount > currentPosition) revert InsufficientAllocation(amount, currentPosition);
        uint256 remainingPosition = currentPosition - amount;
        if (remainingPosition != 0 && remainingPosition < context.minimumAllocation) {
            revert PositionBelowMinimum(remainingPosition, context.minimumAllocation);
        }

        context.gauge.removeAllocation(user, amount);
        if (_gaugePosition(context.gauge, user) != remainingPosition) {
            revert AllocationLedgerMismatch();
        }
        context.vault.releaseAllocation(context.assetUid, user, marketId, amount);
        if (_checkedPosition(context.gauge, context.vault, context.assetUid, user, marketId) != remainingPosition) {
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

        context.vault.rageQuitAllocation(context.assetUid, user, marketId, principal);
        if (context.vault.allocation(context.assetUid, user, marketId) != 0 || _gaugePosition(context.gauge, user) != 0)
        {
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
        context.minimumAllocation = _minimumAllocation(context.assetUid);
    }

    function _gaugePosition(IMemeStockGauge gauge, address user) internal view returns (uint256 amount) {
        PositionView memory position = gauge.positionOf(user);
        return position.activeAmount + position.pendingAmount;
    }
}
