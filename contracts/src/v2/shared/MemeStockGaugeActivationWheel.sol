// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ActivationSlot} from "../interfaces/IV2Protocol.sol";

/// @notice Fixed-size absolute-generation activation wheel shared by the final MemeStockGauge.
/// @dev Snapshot persistence and per-user lazy materialization are layered on through the processing hook.
abstract contract MemeStockGaugeActivationWheel {
    uint8 internal constant ACTIVATION_WHEEL_SIZE = 32;
    uint64 internal constant ACTIVATION_DELAY = 30 seconds;

    ActivationSlot[ACTIVATION_WHEEL_SIZE] internal _activationWheel;
    uint256 internal _storedTotalActiveStock;
    uint256 internal _totalPendingStock;

    error ActivationSlotCollision(uint8 slotIndex, uint64 existingGeneration, uint64 requestedGeneration);
    error PendingGenerationNotFound(uint64 generation);
    error InvalidActivationGeneration(uint64 suppliedGeneration, uint64 expectedGeneration);
    error InvalidActivationBucket(uint256 amount, uint256 refs);
    error InvalidActivationSlotIndex(uint8 slotIndex);
    error InvalidActivationSlotState(uint8 slotIndex, uint64 generation, uint256 amount, uint256 refs);
    error ActivationTimestampOverflow(uint256 timestamp);

    function _checkpointActivations(bytes32 marketId, uint256 quoteAccumulator, uint256 memeAccumulator)
        internal
        returns (uint256 activatedAmount, uint256 processedBuckets)
    {
        for (uint8 i; i < ACTIVATION_WHEEL_SIZE; ++i) {
            ActivationSlot memory slot = _activationWheel[i];
            if (slot.generation == 0 || slot.generation > block.timestamp) continue;
            if (slot.amount == 0 || slot.refs == 0) {
                revert InvalidActivationSlotState(i, slot.generation, slot.amount, slot.refs);
            }

            delete _activationWheel[i];
            _totalPendingStock -= slot.amount;
            _storedTotalActiveStock += slot.amount;
            activatedAmount += slot.amount;
            ++processedBuckets;

            _recordActivationSnapshot(
                marketId, slot.generation, slot.amount, quoteAccumulator, memeAccumulator, slot.refs
            );
        }
    }

    function _scheduleActivation(uint64 generation, uint256 amount, uint256 refs) internal {
        if (amount == 0 || refs == 0) revert InvalidActivationBucket(amount, refs);
        uint64 expectedGeneration = _nextActivationGeneration();
        if (generation != expectedGeneration) {
            revert InvalidActivationGeneration(generation, expectedGeneration);
        }

        uint8 slotIndex = uint8(generation % ACTIVATION_WHEEL_SIZE);
        ActivationSlot storage slot = _activationWheel[slotIndex];
        if (slot.generation == 0) {
            slot.generation = generation;
        } else if (slot.generation != generation) {
            revert ActivationSlotCollision(slotIndex, slot.generation, generation);
        }
        slot.amount += amount;
        slot.refs += refs;
        _totalPendingStock += amount;
    }

    function _unscheduleActivation(uint64 generation, uint256 amount, uint256 refs) internal {
        if (amount == 0 || refs == 0) revert InvalidActivationBucket(amount, refs);
        uint8 slotIndex = uint8(generation % ACTIVATION_WHEEL_SIZE);
        ActivationSlot storage slot = _activationWheel[slotIndex];
        if (slot.generation != generation || slot.amount < amount || slot.refs < refs) {
            revert PendingGenerationNotFound(generation);
        }

        uint256 remainingAmount = slot.amount - amount;
        uint256 remainingRefs = slot.refs - refs;
        if ((remainingAmount == 0) != (remainingRefs == 0)) {
            revert InvalidActivationSlotState(slotIndex, generation, remainingAmount, remainingRefs);
        }

        _totalPendingStock -= amount;
        if (remainingAmount == 0) {
            delete _activationWheel[slotIndex];
        } else {
            slot.amount = remainingAmount;
            slot.refs = remainingRefs;
        }
    }

    function _nextActivationGeneration() internal view returns (uint64 generation) {
        if (block.timestamp > type(uint64).max - ACTIVATION_DELAY) {
            revert ActivationTimestampOverflow(block.timestamp);
        }
        generation = uint64(block.timestamp + ACTIVATION_DELAY);
    }

    function _activationSlot(uint8 slotIndex) internal view returns (ActivationSlot memory) {
        if (slotIndex >= ACTIVATION_WHEEL_SIZE) revert InvalidActivationSlotIndex(slotIndex);
        return _activationWheel[slotIndex];
    }

    function _effectiveTotalActiveStock() internal view returns (uint256 total) {
        total = _storedTotalActiveStock;
        for (uint8 i; i < ACTIVATION_WHEEL_SIZE; ++i) {
            ActivationSlot memory slot = _activationWheel[i];
            if (slot.generation != 0 && slot.generation <= block.timestamp) total += slot.amount;
        }
    }

    function _recordActivationSnapshot(
        bytes32 marketId,
        uint64 generation,
        uint256 amount,
        uint256 quoteAccumulator,
        uint256 memeAccumulator,
        uint256 refs
    ) internal virtual;
}
