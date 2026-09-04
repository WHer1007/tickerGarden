// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ActivationSnapshot} from "../interfaces/IV1Protocol.sol";
import {MemeStockGaugeSettlements} from "./MemeStockGaugeSettlements.sol";

/// @notice Caller-bound full-position escape and reward forfeiture accounting for MemeStockGauge.
abstract contract MemeStockGaugeForfeitures is MemeStockGaugeSettlements {
    struct RageQuitContext {
        bytes32 marketId;
        address quoteAsset;
        address memeAsset;
        uint256 quoteAccumulatorCutoff;
        uint256 memeAccumulatorCutoff;
        bool forfeitureRedistributable;
    }

    event GaugeRageQuit(
        address indexed user,
        bytes32 indexed marketId,
        uint256 principal,
        uint256 quoteForfeited,
        uint256 memeForfeited,
        bool redistributed
    );

    error InvalidRageQuitUser(address user);
    error NoRageQuitPosition(address user);

    function _rageQuitPosition(address user, RageQuitContext memory context)
        internal
        returns (uint256 principal, uint256 quoteForfeited, uint256 memeForfeited, bool redistributed)
    {
        if (user == address(0)) revert InvalidRageQuitUser(user);
        _checkpointRewardActivations(context.marketId);

        GaugePosition storage position = _gaugePositions[user];
        principal = position.activeAmount + position.pendingAmount;
        if (principal == 0) revert NoRageQuitPosition(user);

        _materializeOrCancelPending(
            user, position, context.marketId, context.quoteAccumulatorCutoff, context.memeAccumulatorCutoff
        );
        _settleActivePositionAt(position, context.quoteAccumulatorCutoff, context.memeAccumulatorCutoff);

        uint256 activeAmount = position.activeAmount;
        if (activeAmount != 0) {
            _storedTotalActiveStock -= activeAmount;
            position.activeAmount = 0;
        }
        position.unlockAt = 0;

        redistributed = context.forfeitureRedistributable;
        bool absorbGlobalRemainder = _rewardEligibleActiveStock(context.marketId) == 0;
        quoteForfeited = _forfeitReward(
            position.rewards[QUOTE_REWARD_INDEX], QUOTE_REWARD_INDEX, redistributed, absorbGlobalRemainder
        );
        memeForfeited = _forfeitReward(
            position.rewards[MEME_REWARD_INDEX], MEME_REWARD_INDEX, redistributed, absorbGlobalRemainder
        );

        if (redistributed) {
            if (quoteForfeited != 0) {
                _redistributeForfeitedReward(
                    QUOTE_REWARD_INDEX, context.quoteAsset, quoteForfeited, user, context.marketId
                );
            }
            if (memeForfeited != 0) {
                _redistributeForfeitedReward(
                    MEME_REWARD_INDEX, context.memeAsset, memeForfeited, user, context.marketId
                );
            }
        }

        emit GaugeRageQuit(user, context.marketId, principal, quoteForfeited, memeForfeited, redistributed);
    }

    function _materializeOrCancelPending(
        address user,
        GaugePosition storage position,
        bytes32 marketId,
        uint256 quoteAccumulatorCutoff,
        uint256 memeAccumulatorCutoff
    ) private {
        uint256 pendingAmount = position.pendingAmount;
        if (pendingAmount == 0) return;

        uint64 generation = position.pendingGeneration;
        ActivationSnapshot storage snapshot = _activationSnapshots[generation];
        if (snapshot.processed) {
            if (
                snapshot.quoteAccumulator <= quoteAccumulatorCutoff && snapshot.memeAccumulator <= memeAccumulatorCutoff
            ) {
                _materializePending(user, marketId, quoteAccumulatorCutoff, memeAccumulatorCutoff);
                return;
            }

            // The bucket was processed only after the principal transaction's frozen cutoff. It was therefore
            // ineligible at exit and must be removed from the Gauge aggregate without ever becoming user-active.
            _storedTotalActiveStock -= pendingAmount;
            position.pendingAmount = 0;
            position.pendingGeneration = 0;
            if (snapshot.refs == 1) {
                delete _activationSnapshots[generation];
            } else {
                _activationSnapshots[generation].refs = snapshot.refs - 1;
            }
            return;
        }

        _unscheduleActivation(generation, pendingAmount, 1);
        position.pendingAmount = 0;
        position.pendingGeneration = 0;
    }

    function _forfeitReward(
        GaugeUserReward storage reward,
        uint8 rewardIndex,
        bool redistributed,
        bool absorbGlobalRemainder
    ) private returns (uint256 amount) {
        // A changed cohort can force this user's forfeiture into reserve even while active weight remains.
        // Only a truly empty current cohort owns no global carry; do not sweep surviving stakers' carry merely
        // because historical-cohort redistribution failed closed.
        amount = _collectForfeitedReward(
            rewardIndex, reward.pendingFee, reward.userRemainder, !redistributed && absorbGlobalRemainder
        );
        reward.pendingFee = 0;
        reward.userRemainder = 0;
    }
}
