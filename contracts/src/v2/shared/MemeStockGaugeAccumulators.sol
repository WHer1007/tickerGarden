// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

import {MemeStockGaugeLockedPositions} from "./MemeStockGaugeLockedPositions.sol";

/// @notice Full-precision, asset-isolated accumulator primitives shared by MemeStockGauge.
/// @dev Position lifecycle settlement composes these primitives in the following C204 layer.
abstract contract MemeStockGaugeAccumulators is MemeStockGaugeLockedPositions {
    uint256 internal constant INDEX_PRECISION = 1e27;
    uint8 internal constant QUOTE_REWARD_INDEX = 0;
    uint8 internal constant MEME_REWARD_INDEX = 1;
    uint8 internal constant REWARD_ASSET_COUNT = 2;

    struct GaugeRewardState {
        uint256 accFeePerShare;
        uint256 indexRemainder;
    }

    GaugeRewardState[REWARD_ASSET_COUNT] internal _rewardStates;
    uint256[REWARD_ASSET_COUNT] internal _forfeiturePrecisionRemainders;

    event StakerFeeCredited(
        bytes32 indexed marketId,
        address indexed feeAsset,
        bytes32 indexed feeId,
        uint256 amount,
        uint256 accumulatorDelta,
        uint256 indexRemainder
    );
    event ForfeitedRewardRedistributed(
        bytes32 indexed marketId,
        address indexed user,
        address indexed feeAsset,
        uint256 amount,
        uint256 accumulatorDelta,
        uint256 indexRemainder
    );

    error InvalidRewardIndex(uint8 rewardIndex);
    error StakerCreditWithoutActiveStock(uint256 amount);
    error RewardAccumulatorRegression(uint256 startingAccumulator, uint256 currentAccumulator);
    error InvalidUserRewardRemainder(uint256 remainder);

    /// @dev Checkpoints first so a bucket maturing at this timestamp participates in this credit.
    function _creditStakerFee(uint8 rewardIndex, address feeAsset, uint256 amount, bytes32 feeId, bytes32 marketId)
        internal
        returns (uint256 accumulatorDelta, uint256 indexRemainder)
    {
        _checkpointRewardActivations(marketId);
        _requireRewardIndex(rewardIndex);

        return _applyStakerFee(rewardIndex, feeAsset, amount, feeId, marketId);
    }

    function _applyStakerFee(uint8 rewardIndex, address feeAsset, uint256 amount, bytes32 feeId, bytes32 marketId)
        internal
        returns (uint256 accumulatorDelta, uint256 indexRemainder)
    {
        _requireRewardIndex(rewardIndex);

        (accumulatorDelta, indexRemainder) = _increaseRewardAccumulator(rewardIndex, amount);

        emit StakerFeeCredited(marketId, feeAsset, feeId, amount, accumulatorDelta, indexRemainder);
    }

    function _redistributeForfeitedReward(
        uint8 rewardIndex,
        address feeAsset,
        uint256 amount,
        address user,
        bytes32 marketId
    ) internal returns (uint256 accumulatorDelta, uint256 indexRemainder) {
        _requireRewardIndex(rewardIndex);
        (accumulatorDelta, indexRemainder) = _increaseRewardAccumulator(rewardIndex, amount);
        emit ForfeitedRewardRedistributed(marketId, user, feeAsset, amount, accumulatorDelta, indexRemainder);
    }

    /// @dev User and global reward remainders are both numerators in token-unit * INDEX_PRECISION space.
    ///      A global remainder is absorbed only when no active weight remains; otherwise it continues with
    ///      the surviving cohort through the normal accumulator carry path.
    function _collectForfeitedReward(
        uint8 rewardIndex,
        uint256 pendingFee,
        uint256 userRemainder,
        bool absorbGlobalRemainder
    ) internal returns (uint256 amount) {
        _requireRewardIndex(rewardIndex);
        if (userRemainder >= INDEX_PRECISION) revert InvalidUserRewardRemainder(userRemainder);

        uint256 precisionRemainder = _forfeiturePrecisionRemainders[rewardIndex] + userRemainder;
        amount = pendingFee;
        if (absorbGlobalRemainder) {
            uint256 globalRemainder = _rewardStates[rewardIndex].indexRemainder;
            _rewardStates[rewardIndex].indexRemainder = 0;
            amount += globalRemainder / INDEX_PRECISION;
            precisionRemainder += globalRemainder % INDEX_PRECISION;
        }
        amount += precisionRemainder / INDEX_PRECISION;
        _forfeiturePrecisionRemainders[rewardIndex] = precisionRemainder % INDEX_PRECISION;
    }

    function _increaseRewardAccumulator(uint8 rewardIndex, uint256 amount)
        private
        returns (uint256 accumulatorDelta, uint256 indexRemainder)
    {
        GaugeRewardState storage state = _rewardStates[rewardIndex];
        if (amount == 0) return (0, state.indexRemainder);

        uint256 activeStock = _storedTotalActiveStock;
        if (activeStock == 0) revert StakerCreditWithoutActiveStock(amount);

        uint256 carry = state.indexRemainder / activeStock;
        uint256 normalizedRemainder = state.indexRemainder % activeStock;
        uint256 whole = Math.mulDiv(amount, INDEX_PRECISION, activeStock);
        uint256 fraction = mulmod(amount, INDEX_PRECISION, activeStock);
        uint256 merged = normalizedRemainder + fraction;

        accumulatorDelta = carry + whole + (merged / activeStock);
        indexRemainder = merged % activeStock;
        state.accFeePerShare += accumulatorDelta;
        state.indexRemainder = indexRemainder;
    }

    function _checkpointRewardActivations(bytes32 marketId)
        internal
        returns (uint256 activatedAmount, uint256 processedBuckets)
    {
        return _checkpointActivations(
            marketId, _rewardStates[QUOTE_REWARD_INDEX].accFeePerShare, _rewardStates[MEME_REWARD_INDEX].accFeePerShare
        );
    }

    /// @dev Accrues one weight/index interval without changing accumulatorPaid. This permits
    ///      C204-C to combine old-active and activation-snapshot terms through one remainder.
    function _accrueRewardTerm(
        GaugeUserReward storage reward,
        uint256 amount,
        uint256 startingAccumulator,
        uint256 currentAccumulator
    ) internal returns (uint256 accrued) {
        if (currentAccumulator < startingAccumulator) {
            revert RewardAccumulatorRegression(startingAccumulator, currentAccumulator);
        }
        if (reward.userRemainder >= INDEX_PRECISION) {
            revert InvalidUserRewardRemainder(reward.userRemainder);
        }

        uint256 accumulatorDelta = currentAccumulator - startingAccumulator;
        if (amount == 0 || accumulatorDelta == 0) return 0;

        uint256 whole = Math.mulDiv(amount, accumulatorDelta, INDEX_PRECISION);
        uint256 fraction = mulmod(amount, accumulatorDelta, INDEX_PRECISION);
        uint256 merged = reward.userRemainder + fraction;
        accrued = whole + (merged / INDEX_PRECISION);
        reward.pendingFee += accrued;
        reward.userRemainder = merged % INDEX_PRECISION;
    }

    function _settleRewardToCurrent(GaugeUserReward storage reward, uint256 amount, uint256 currentAccumulator)
        internal
        returns (uint256 accrued)
    {
        accrued = _accrueRewardTerm(reward, amount, reward.accumulatorPaid, currentAccumulator);
        reward.accumulatorPaid = currentAccumulator;
    }

    /// @dev Consuming an integer claim never discards paid-index history or fractional ownership.
    function _consumeClaimable(address user, uint8 rewardIndex) internal returns (uint256 amount) {
        _requireRewardIndex(rewardIndex);
        GaugeUserReward storage reward = _gaugePositions[user].rewards[rewardIndex];
        amount = reward.pendingFee;
        reward.pendingFee = 0;
    }

    function _rewardState(uint8 rewardIndex) internal view returns (GaugeRewardState memory) {
        _requireRewardIndex(rewardIndex);
        return _rewardStates[rewardIndex];
    }

    function _claimable(address user, uint8 rewardIndex) internal view returns (uint256) {
        _requireRewardIndex(rewardIndex);
        return _gaugePositions[user].rewards[rewardIndex].pendingFee;
    }

    function _requireRewardIndex(uint8 rewardIndex) private pure {
        if (rewardIndex >= REWARD_ASSET_COUNT) revert InvalidRewardIndex(rewardIndex);
    }
}
