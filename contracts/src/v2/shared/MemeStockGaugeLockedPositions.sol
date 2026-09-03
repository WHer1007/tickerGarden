// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {MemeStockGaugePendingPositions} from "./MemeStockGaugePendingPositions.sol";

/// @notice Whole-position lock enforcement and active-weight removal for MemeStockGauge.
/// @dev The AllocationManager repeats lock/minimum/ledger checks around this defensive Gauge boundary.
abstract contract MemeStockGaugeLockedPositions is MemeStockGaugePendingPositions {
    error InvalidRemovalUser(address user);
    error InvalidRemovalAmount(uint256 amount);
    error InvalidPositionLock(address user, uint64 unlockAt);
    error PositionLockedUntil(uint64 unlockAt);
    error PendingPositionNotMaterialized(address user, uint256 amount, uint64 generation);
    error InsufficientActiveAllocation(uint256 requested, uint256 available);
    error NoActiveAllocation(address user);

    function _removeAllocation(
        address user,
        uint256 amount,
        bytes32 marketId,
        uint256 currentQuoteAccumulator,
        uint256 currentMemeAccumulator
    ) internal returns (uint256 remainingActive) {
        _checkpointActivations(marketId, currentQuoteAccumulator, currentMemeAccumulator);

        if (user == address(0)) revert InvalidRemovalUser(user);
        if (amount == 0) revert InvalidRemovalAmount(amount);

        _materializePending(user, marketId, currentQuoteAccumulator, currentMemeAccumulator);
        GaugePosition storage position = _gaugePositions[user];
        if (position.pendingAmount != 0 || position.pendingGeneration != 0) {
            revert PendingPositionNotMaterialized(user, position.pendingAmount, position.pendingGeneration);
        }
        if (position.activeAmount == 0) revert NoActiveAllocation(user);
        if (position.unlockAt == 0) revert InvalidPositionLock(user, position.unlockAt);
        if (block.timestamp < position.unlockAt) revert PositionLockedUntil(position.unlockAt);

        _settleRemovingPosition(user, position, currentQuoteAccumulator, currentMemeAccumulator);
        if (amount > position.activeAmount) {
            revert InsufficientActiveAllocation(amount, position.activeAmount);
        }

        remainingActive = position.activeAmount - amount;
        position.activeAmount = remainingActive;
        _storedTotalActiveStock -= amount;
        if (remainingActive == 0) position.unlockAt = 0;
    }

    /// @dev Must settle both reward assets against the position's full pre-removal active weight
    ///      and advance both paid indices to the supplied current accumulators.
    function _settleRemovingPosition(
        address user,
        GaugePosition storage position,
        uint256 currentQuoteAccumulator,
        uint256 currentMemeAccumulator
    ) internal virtual;
}
