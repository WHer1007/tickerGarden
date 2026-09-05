// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ActivationSnapshot} from "../interfaces/IV1Protocol.sol";
import {MemeStockGaugeSettlements} from "./MemeStockGaugeSettlements.sol";

/// @notice Caller-bound full-position escape and reward forfeiture accounting for MemeStockGauge.
abstract contract MemeStockGaugeForfeitures is MemeStockGaugeSettlements {
    struct RageQuitContext {
        bytes32 marketId;
        uint256 quoteAccumulatorCutoff;
        uint256 memeAccumulatorCutoff;
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

        bool absorbGlobalRemainder = _rewardEligibleActiveStock(context.marketId) == 0;
        quoteForfeited = _forfeitReward(position.rewards[QUOTE_REWARD_INDEX], QUOTE_REWARD_INDEX, absorbGlobalRemainder);
        memeForfeited = _forfeitReward(position.rewards[MEME_REWARD_INDEX], MEME_REWARD_INDEX, absorbGlobalRemainder);

        // The return slot remains for compatibility with existing manager events, but escaped rewards are
        // never reintroduced into the Gauge accumulator.  MemeStockGauge records both values in the
        // ProtocolFeeVault platform forfeiture reserve below.
        redistributed = false;

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

    function _forfeitReward(GaugeUserReward storage reward, uint8 rewardIndex, bool absorbGlobalRemainder)
        private
        returns (uint256 amount)
    {
        // User reward carry is always forfeited to the platform reserve. A global index remainder is only
        // absorbed when no eligible stock remains; with an active cohort it remains normal accumulator carry.
        amount = _collectForfeitedReward(rewardIndex, reward.pendingFee, reward.userRemainder, absorbGlobalRemainder);
        reward.pendingFee = 0;
        reward.userRemainder = 0;
    }
}
