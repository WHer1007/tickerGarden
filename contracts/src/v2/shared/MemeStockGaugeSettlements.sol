// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

import {ActivationSnapshot} from "../interfaces/IV2Protocol.sol";
import {MemeStockGaugeAccumulators} from "./MemeStockGaugeAccumulators.sol";

/// @notice Composes active and activation-snapshot reward intervals for MemeStockGauge.
abstract contract MemeStockGaugeSettlements is MemeStockGaugeAccumulators {
    error InvalidSettlementUser(address user);

    function _settlePosition(address user, bytes32 marketId) internal {
        _checkpointRewardActivations(marketId);
        if (user == address(0)) revert InvalidSettlementUser(user);

        _materializePending(
            user,
            marketId,
            _rewardStates[QUOTE_REWARD_INDEX].accFeePerShare,
            _rewardStates[MEME_REWARD_INDEX].accFeePerShare
        );
        _settleActivePosition(_gaugePositions[user]);
    }

    function _settleMaterializingPosition(
        address,
        GaugePosition storage position,
        ActivationSnapshot memory snapshot,
        uint256 currentQuoteAccumulator,
        uint256 currentMemeAccumulator
    ) internal override {
        _settleMaterializingReward(
            position.rewards[QUOTE_REWARD_INDEX],
            position.activeAmount,
            position.pendingAmount,
            snapshot.quoteAccumulator,
            currentQuoteAccumulator
        );
        _settleMaterializingReward(
            position.rewards[MEME_REWARD_INDEX],
            position.activeAmount,
            position.pendingAmount,
            snapshot.memeAccumulator,
            currentMemeAccumulator
        );
    }

    function _settleAddingPosition(address, GaugePosition storage position, uint256, uint256) internal override {
        _settleActivePosition(position);
    }

    function _settleRemovingPosition(address, GaugePosition storage position, uint256, uint256) internal override {
        _settleActivePosition(position);
    }

    function _settleActivePosition(GaugePosition storage position) internal {
        _settleRewardToCurrent(
            position.rewards[QUOTE_REWARD_INDEX],
            position.activeAmount,
            _rewardStates[QUOTE_REWARD_INDEX].accFeePerShare
        );
        _settleRewardToCurrent(
            position.rewards[MEME_REWARD_INDEX], position.activeAmount, _rewardStates[MEME_REWARD_INDEX].accFeePerShare
        );
    }

    function _settleMaterializingReward(
        GaugeUserReward storage reward,
        uint256 activeAmount,
        uint256 pendingAmount,
        uint256 snapshotAccumulator,
        uint256 currentAccumulator
    ) private {
        _accrueRewardTerm(reward, activeAmount, reward.accumulatorPaid, currentAccumulator);
        _accrueRewardTerm(reward, pendingAmount, snapshotAccumulator, currentAccumulator);
        reward.accumulatorPaid = currentAccumulator;
    }

    function _previewClaimable(address user, uint8 rewardIndex) internal view returns (uint256 claimable) {
        GaugePosition storage position = _gaugePositions[user];
        GaugeUserReward storage reward = position.rewards[rewardIndex];
        GaugeRewardState storage state = _rewardStates[rewardIndex];
        claimable = reward.pendingFee;
        uint256 remainder = reward.userRemainder;

        (claimable, remainder) =
            _previewTerm(claimable, remainder, position.activeAmount, reward.accumulatorPaid, state.accFeePerShare);

        if (position.pendingAmount != 0) {
            ActivationSnapshot storage snapshot = _activationSnapshots[position.pendingGeneration];
            if (snapshot.processed) {
                uint256 snapshotAccumulator =
                    rewardIndex == QUOTE_REWARD_INDEX ? snapshot.quoteAccumulator : snapshot.memeAccumulator;
                (claimable,) = _previewTerm(
                    claimable, remainder, position.pendingAmount, snapshotAccumulator, state.accFeePerShare
                );
            }
        }
    }

    function _previewTerm(
        uint256 claimable,
        uint256 remainder,
        uint256 amount,
        uint256 startingAccumulator,
        uint256 currentAccumulator
    ) private pure returns (uint256 nextClaimable, uint256 nextRemainder) {
        if (currentAccumulator < startingAccumulator) {
            revert RewardAccumulatorRegression(startingAccumulator, currentAccumulator);
        }
        if (remainder >= INDEX_PRECISION) revert InvalidUserRewardRemainder(remainder);

        uint256 accumulatorDelta = currentAccumulator - startingAccumulator;
        if (amount == 0 || accumulatorDelta == 0) return (claimable, remainder);

        uint256 whole = Math.mulDiv(amount, accumulatorDelta, INDEX_PRECISION);
        uint256 fraction = mulmod(amount, accumulatorDelta, INDEX_PRECISION);
        uint256 merged = remainder + fraction;
        nextClaimable = claimable + whole + (merged / INDEX_PRECISION);
        nextRemainder = merged % INDEX_PRECISION;
    }
}
