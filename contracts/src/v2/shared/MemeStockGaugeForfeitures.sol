// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ActivationSnapshot} from "../interfaces/IV2Protocol.sol";
import {MemeStockGaugeSettlements} from "./MemeStockGaugeSettlements.sol";

/// @notice Caller-bound full-position escape and reward forfeiture accounting for MemeStockGauge.
abstract contract MemeStockGaugeForfeitures is MemeStockGaugeSettlements {
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

    function _rageQuitPosition(address user, bytes32 marketId, address quoteAsset, address memeAsset)
        internal
        returns (uint256 principal, uint256 quoteForfeited, uint256 memeForfeited, bool redistributed)
    {
        if (user == address(0)) revert InvalidRageQuitUser(user);
        _checkpointRewardActivations(marketId);

        GaugePosition storage position = _gaugePositions[user];
        principal = position.activeAmount + position.pendingAmount;
        if (principal == 0) revert NoRageQuitPosition(user);

        _materializeOrCancelPending(user, position, marketId);
        _settleActivePosition(position);

        uint256 activeAmount = position.activeAmount;
        if (activeAmount != 0) {
            _storedTotalActiveStock -= activeAmount;
            position.activeAmount = 0;
        }
        position.unlockAt = 0;

        redistributed = _storedTotalActiveStock != 0;
        quoteForfeited = _forfeitReward(position.rewards[QUOTE_REWARD_INDEX], QUOTE_REWARD_INDEX, redistributed);
        memeForfeited = _forfeitReward(position.rewards[MEME_REWARD_INDEX], MEME_REWARD_INDEX, redistributed);

        if (redistributed) {
            if (quoteForfeited != 0) {
                _redistributeForfeitedReward(QUOTE_REWARD_INDEX, quoteAsset, quoteForfeited, user, marketId);
            }
            if (memeForfeited != 0) {
                _redistributeForfeitedReward(MEME_REWARD_INDEX, memeAsset, memeForfeited, user, marketId);
            }
        }

        emit GaugeRageQuit(user, marketId, principal, quoteForfeited, memeForfeited, redistributed);
    }

    function _materializeOrCancelPending(address user, GaugePosition storage position, bytes32 marketId) private {
        uint256 pendingAmount = position.pendingAmount;
        if (pendingAmount == 0) return;

        uint64 generation = position.pendingGeneration;
        ActivationSnapshot storage snapshot = _activationSnapshots[generation];
        if (snapshot.processed) {
            _materializePending(
                user,
                marketId,
                _rewardStates[QUOTE_REWARD_INDEX].accFeePerShare,
                _rewardStates[MEME_REWARD_INDEX].accFeePerShare
            );
            return;
        }

        _unscheduleActivation(generation, pendingAmount, 1);
        position.pendingAmount = 0;
        position.pendingGeneration = 0;
    }

    function _forfeitReward(GaugeUserReward storage reward, uint8 rewardIndex, bool redistributed)
        private
        returns (uint256 amount)
    {
        amount = _collectForfeitedReward(rewardIndex, reward.pendingFee, reward.userRemainder, !redistributed);
        reward.pendingFee = 0;
        reward.userRemainder = 0;
    }
}
