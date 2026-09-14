// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {UserStockVaultDeposits} from "./UserStockVaultDeposits.sol";

/// @notice Vault-authoritative reward eligibility and rage-quit accumulator cutoffs.
/// @dev Gauge positions remain the detailed reward ledger, but this fixed-size mirror is the authority for
///      aggregate active weight. A principal-first rage quit can therefore invalidate reward weight without
///      making the principal transfer depend on a live Gauge call.
abstract contract UserStockVaultRewardAccounting is UserStockVaultDeposits {
    uint8 internal constant REWARD_ACTIVATION_WHEEL_SIZE = 32;
    uint64 internal constant REWARD_ACTIVATION_DELAY = 30 seconds;

    struct RewardActivationSlot {
        uint64 generation;
        uint256 amount;
        uint256 refs;
    }

    struct RewardEligibilityPosition {
        uint64 pendingGeneration;
        uint256 pendingAmount;
    }

    struct RewardAccumulatorPair {
        uint256 quoteAccumulator;
        uint256 memeAccumulator;
    }

    struct RageQuitRewardSnapshot {
        uint256 quoteAccumulator;
        uint256 memeAccumulator;
    }

    mapping(
        bytes32 assetUid => mapping(bytes32 marketId => RewardActivationSlot[REWARD_ACTIVATION_WHEEL_SIZE] slots)
    ) internal _rewardActivationWheels;
    mapping(bytes32 assetUid => mapping(bytes32 marketId => uint256 amount)) internal _storedRewardActive;
    // Monotonic history: a later matured pending bucket must not hide a zero-active boundary.
    mapping(bytes32 assetUid => mapping(bytes32 marketId => uint256 epoch)) internal _rewardCohortEpochs;
    mapping(bytes32 assetUid => mapping(bytes32 marketId => uint256 amount)) internal _rewardPending;
    mapping(
        bytes32 assetUid => mapping(address user => mapping(bytes32 marketId => RewardEligibilityPosition value))
    ) internal _rewardEligibilityPositions;
    mapping(bytes32 assetUid => mapping(bytes32 marketId => RewardAccumulatorPair value)) internal
        _latestRewardAccumulators;
    mapping(bytes32 assetUid => mapping(address user => mapping(bytes32 marketId => RageQuitRewardSnapshot value)))
        internal _rageQuitRewardCutoffs;

    error RewardActivationTimestampOverflow(uint256 timestamp);
    error RewardActivationSlotCollision(uint8 slotIndex, uint64 existingGeneration, uint64 requestedGeneration);
    error RewardActivationBucketNotFound(uint64 generation);
    error InvalidRewardActivationBucket(uint256 amount, uint256 refs);
    error InvalidRewardActivationSlot(uint8 slotIndex, uint64 generation, uint256 amount, uint256 refs);
    error RewardEligibilityLedgerMismatch(uint256 allocation, uint256 pending);
    error RewardAccumulatorRegression(
        uint256 previousQuote, uint256 suppliedQuote, uint256 previousMeme, uint256 suppliedMeme
    );

    constructor(address officialStockRegistry_, address marketRegistry_, address allocationManager_)
        UserStockVaultDeposits(officialStockRegistry_, marketRegistry_, allocationManager_)
    {}

    function _lockRewardEligibility(bytes32 assetUid, address user, bytes32 marketId, uint256 amount) internal {
        _checkpointRewardEligibility(assetUid, marketId);
        RewardEligibilityPosition storage position = _rewardEligibilityPositions[assetUid][user][marketId];
        _materializeRewardEligibility(position);

        uint256 oldPending = position.pendingAmount;
        if (oldPending != 0) {
            _unscheduleRewardEligibility(assetUid, marketId, position.pendingGeneration, oldPending, 1);
        }

        uint64 generation = _nextRewardActivationGeneration();
        uint256 combinedPending = oldPending + amount;
        _scheduleRewardEligibility(assetUid, marketId, generation, combinedPending, 1);
        position.pendingGeneration = generation;
        position.pendingAmount = combinedPending;
    }

    function _removeRewardEligibility(bytes32 assetUid, address user, bytes32 marketId, uint256 allocationAmount)
        internal
    {
        _checkpointRewardEligibility(assetUid, marketId);
        RewardEligibilityPosition storage position = _rewardEligibilityPositions[assetUid][user][marketId];
        _materializeRewardEligibility(position);

        uint256 pendingAmount = position.pendingAmount;
        if (pendingAmount > allocationAmount) {
            revert RewardEligibilityLedgerMismatch(allocationAmount, pendingAmount);
        }
        if (pendingAmount != 0) {
            _unscheduleRewardEligibility(assetUid, marketId, position.pendingGeneration, pendingAmount, 1);
        }

        uint256 activeAmount = allocationAmount - pendingAmount;
        uint256 storedActive = _storedRewardActive[assetUid][marketId];
        if (activeAmount > storedActive) {
            revert RewardEligibilityLedgerMismatch(storedActive, activeAmount);
        }
        _storedRewardActive[assetUid][marketId] = storedActive - activeAmount;
        if (activeAmount != 0 && activeAmount == storedActive) {
            ++_rewardCohortEpochs[assetUid][marketId];
        }
        delete _rewardEligibilityPositions[assetUid][user][marketId];
    }

    function _recordGaugeRewardState(
        bytes32 assetUid,
        bytes32 marketId,
        uint256 quoteAccumulator,
        uint256 memeAccumulator
    ) internal {
        _canonicalMarket(assetUid, marketId);
        RewardAccumulatorPair storage current = _latestRewardAccumulators[assetUid][marketId];
        if (quoteAccumulator < current.quoteAccumulator || memeAccumulator < current.memeAccumulator) {
            revert RewardAccumulatorRegression(
                current.quoteAccumulator, quoteAccumulator, current.memeAccumulator, memeAccumulator
            );
        }
        current.quoteAccumulator = quoteAccumulator;
        current.memeAccumulator = memeAccumulator;
    }

    function _snapshotRageQuitRewardCutoff(bytes32 assetUid, address user, bytes32 marketId) internal {
        RewardAccumulatorPair storage latest = _latestRewardAccumulators[assetUid][marketId];
        _rageQuitRewardCutoffs[assetUid][user][marketId] = RageQuitRewardSnapshot({
            quoteAccumulator: latest.quoteAccumulator, memeAccumulator: latest.memeAccumulator
        });
    }

    function _clearRageQuitRewardCutoff(bytes32 assetUid, address user, bytes32 marketId) internal {
        delete _rageQuitRewardCutoffs[assetUid][user][marketId];
    }

    function _marketRewardEligible(bytes32 assetUid, bytes32 marketId) internal view returns (uint256 total) {
        total = _storedRewardActive[assetUid][marketId];
        if (_rewardPending[assetUid][marketId] == 0) return total;
        RewardActivationSlot[REWARD_ACTIVATION_WHEEL_SIZE] storage wheel = _rewardActivationWheels[assetUid][marketId];
        for (uint8 i; i < REWARD_ACTIVATION_WHEEL_SIZE; ++i) {
            RewardActivationSlot storage slot = wheel[i];
            if (slot.generation != 0 && slot.generation <= block.timestamp) total += slot.amount;
        }
    }

    function _rageQuitRewardCutoff(bytes32 assetUid, address user, bytes32 marketId)
        internal
        view
        returns (uint256 quoteAccumulator, uint256 memeAccumulator)
    {
        RageQuitRewardSnapshot storage cutoff = _rageQuitRewardCutoffs[assetUid][user][marketId];
        quoteAccumulator = cutoff.quoteAccumulator;
        memeAccumulator = cutoff.memeAccumulator;
    }

    function _checkpointRewardEligibility(bytes32 assetUid, bytes32 marketId) private {
        if (_rewardPending[assetUid][marketId] == 0) return;
        RewardActivationSlot[REWARD_ACTIVATION_WHEEL_SIZE] storage wheel = _rewardActivationWheels[assetUid][marketId];
        for (uint8 i; i < REWARD_ACTIVATION_WHEEL_SIZE; ++i) {
            RewardActivationSlot storage stored = wheel[i];
            uint64 generation = stored.generation;
            if (generation == 0 || generation > block.timestamp) continue;
            RewardActivationSlot memory slot = stored;
            if (slot.amount == 0 || slot.refs == 0) {
                revert InvalidRewardActivationSlot(i, slot.generation, slot.amount, slot.refs);
            }

            delete wheel[i];
            _rewardPending[assetUid][marketId] -= slot.amount;
            _storedRewardActive[assetUid][marketId] += slot.amount;
        }
    }

    function _materializeRewardEligibility(RewardEligibilityPosition storage position) private {
        if (position.pendingAmount != 0 && position.pendingGeneration <= block.timestamp) {
            position.pendingGeneration = 0;
            position.pendingAmount = 0;
        }
    }

    function _scheduleRewardEligibility(
        bytes32 assetUid,
        bytes32 marketId,
        uint64 generation,
        uint256 amount,
        uint256 refs
    ) private {
        if (amount == 0 || refs == 0) revert InvalidRewardActivationBucket(amount, refs);
        uint8 slotIndex = uint8(generation % REWARD_ACTIVATION_WHEEL_SIZE);
        RewardActivationSlot storage slot = _rewardActivationWheels[assetUid][marketId][slotIndex];
        if (slot.generation == 0) {
            slot.generation = generation;
        } else if (slot.generation != generation) {
            revert RewardActivationSlotCollision(slotIndex, slot.generation, generation);
        }
        slot.amount += amount;
        slot.refs += refs;
        _rewardPending[assetUid][marketId] += amount;
    }

    function _unscheduleRewardEligibility(
        bytes32 assetUid,
        bytes32 marketId,
        uint64 generation,
        uint256 amount,
        uint256 refs
    ) private {
        if (amount == 0 || refs == 0) revert InvalidRewardActivationBucket(amount, refs);
        uint8 slotIndex = uint8(generation % REWARD_ACTIVATION_WHEEL_SIZE);
        RewardActivationSlot storage slot = _rewardActivationWheels[assetUid][marketId][slotIndex];
        if (slot.generation != generation || slot.amount < amount || slot.refs < refs) {
            revert RewardActivationBucketNotFound(generation);
        }

        uint256 remainingAmount = slot.amount - amount;
        uint256 remainingRefs = slot.refs - refs;
        if ((remainingAmount == 0) != (remainingRefs == 0)) {
            revert InvalidRewardActivationSlot(slotIndex, generation, remainingAmount, remainingRefs);
        }
        _rewardPending[assetUid][marketId] -= amount;
        if (remainingAmount == 0) {
            delete _rewardActivationWheels[assetUid][marketId][slotIndex];
        } else {
            slot.amount = remainingAmount;
            slot.refs = remainingRefs;
        }
    }

    function _nextRewardActivationGeneration() private view returns (uint64 generation) {
        if (block.timestamp > type(uint64).max - REWARD_ACTIVATION_DELAY) {
            revert RewardActivationTimestampOverflow(block.timestamp);
        }
        generation = uint64(block.timestamp + REWARD_ACTIVATION_DELAY);
    }
}
