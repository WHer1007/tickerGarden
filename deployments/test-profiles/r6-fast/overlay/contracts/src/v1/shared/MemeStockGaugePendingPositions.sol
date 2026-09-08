// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {MemeStockGaugeActivationSnapshots} from "./MemeStockGaugeActivationSnapshots.sol";

/// @notice Single-pending-position scheduling and reset logic shared by MemeStockGauge.
abstract contract MemeStockGaugePendingPositions is MemeStockGaugeActivationSnapshots {
    uint64 internal constant MINIMUM_POSITION_LOCK = 20 minutes;

    event PendingScheduled(
        address indexed user, bytes32 indexed marketId, uint256 amount, uint64 generation, uint64 unlockAt
    );
    event PendingRescheduled(
        address indexed user,
        bytes32 indexed marketId,
        uint64 oldGeneration,
        uint64 newGeneration,
        uint256 combinedAmount,
        uint64 unlockAt
    );

    error InvalidPendingUser(address user);
    error InvalidPendingAmount(uint256 amount);
    error InvalidPendingSchedule(
        uint64 suppliedGeneration, uint64 suppliedUnlockAt, uint64 expectedGeneration, uint64 expectedUnlockAt
    );
    error PositionLockTimestampOverflow(uint256 timestamp);

    function _addPending(
        address user,
        uint256 amount,
        uint64 suppliedGeneration,
        uint64 suppliedUnlockAt,
        bytes32 marketId,
        uint256 currentQuoteAccumulator,
        uint256 currentMemeAccumulator
    ) internal returns (uint256 combinedAmount, uint64 generation, uint64 unlockAt) {
        _checkpointActivations(marketId, currentQuoteAccumulator, currentMemeAccumulator);

        if (user == address(0)) revert InvalidPendingUser(user);
        if (amount == 0) revert InvalidPendingAmount(amount);
        generation = _nextActivationGeneration();
        unlockAt = _nextPositionUnlockAt();
        if (suppliedGeneration != generation || suppliedUnlockAt != unlockAt) {
            revert InvalidPendingSchedule(suppliedGeneration, suppliedUnlockAt, generation, unlockAt);
        }

        _materializePending(user, marketId, currentQuoteAccumulator, currentMemeAccumulator);

        GaugePosition storage position = _gaugePositions[user];
        _settleAddingPosition(user, position, currentQuoteAccumulator, currentMemeAccumulator);
        uint64 oldGeneration = position.pendingGeneration;
        uint256 oldPendingAmount = position.pendingAmount;
        if (oldPendingAmount == 0) {
            if (oldGeneration != 0) {
                revert InvalidGaugePosition(user, oldPendingAmount, oldGeneration);
            }
            combinedAmount = amount;
            _scheduleActivation(generation, combinedAmount, 1);
            position.pendingAmount = combinedAmount;
            position.pendingGeneration = generation;
            position.unlockAt = unlockAt;
            emit PendingScheduled(user, marketId, amount, generation, unlockAt);
            return (combinedAmount, generation, unlockAt);
        }
        if (oldGeneration == 0) {
            revert InvalidGaugePosition(user, oldPendingAmount, oldGeneration);
        }

        _unscheduleActivation(oldGeneration, oldPendingAmount, 1);
        combinedAmount = oldPendingAmount + amount;
        _scheduleActivation(generation, combinedAmount, 1);
        position.pendingAmount = combinedAmount;
        position.pendingGeneration = generation;
        position.unlockAt = unlockAt;
        emit PendingRescheduled(user, marketId, oldGeneration, generation, combinedAmount, unlockAt);
    }

    function _nextPositionUnlockAt() internal view returns (uint64 unlockAt) {
        if (block.timestamp > type(uint64).max - MINIMUM_POSITION_LOCK) {
            revert PositionLockTimestampOverflow(block.timestamp);
        }
        unlockAt = uint64(block.timestamp + MINIMUM_POSITION_LOCK);
    }

    /// @dev Later reward layers settle the unchanged old active weight before scheduling new pending weight.
    function _settleAddingPosition(
        address user,
        GaugePosition storage position,
        uint256 currentQuoteAccumulator,
        uint256 currentMemeAccumulator
    ) internal virtual {}
}
