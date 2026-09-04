// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IAllocationManager} from "../interfaces/IV1Protocol.sol";
import {AllocationManagerDeposits} from "../shared/AllocationManagerDeposits.sol";

/// @notice Canonical caller-bound coordinator for Vault allocation and per-market Gauge weight.
contract AllocationManager is IAllocationManager, AllocationManagerDeposits {
    constructor(address officialStockRegistry_, address marketRegistry_)
        AllocationManagerDeposits(officialStockRegistry_, marketRegistry_)
    {}

    function allocate(bytes32 marketId, uint256 amount) external override {
        _increaseAllocation(msg.sender, marketId, amount);
    }

    function increaseAllocation(bytes32 marketId, uint256 amount) external override {
        _increaseAllocation(msg.sender, marketId, amount);
    }

    function closeAllocation(bytes32 marketId) external override {
        _closeAllocation(msg.sender, marketId);
    }

    function rageQuit(bytes32 marketId) external override nonReentrant {
        (
            uint256 principal,
            uint256 quoteForfeited,
            uint256 memeForfeited,
            bool redistributed,
            bool rewardSettlementCompleted,
            address gauge
        ) = _rageQuitAllocationWithSettlement(msg.sender, marketId);
        emit AllocationRageQuitExecuted(msg.sender, marketId, principal, quoteForfeited, memeForfeited, redistributed);
        if (rewardSettlementCompleted) {
            emit RageQuitRewardSettlementFinalized(
                msg.sender, marketId, principal, quoteForfeited, memeForfeited, redistributed
            );
        } else {
            emit RageQuitRewardSettlementDeferred(msg.sender, marketId, principal, gauge);
        }
    }

    function settleRageQuitRewards(bytes32 marketId, address user)
        external
        override
        returns (uint256 quoteForfeited, uint256 memeForfeited, bool redistributed)
    {
        uint256 principal;
        (principal, quoteForfeited, memeForfeited, redistributed) = _settleRageQuitRewards(user, marketId);
        emit RageQuitRewardSettlementFinalized(user, marketId, principal, quoteForfeited, memeForfeited, redistributed);
    }

    function rageQuitSettlementPending(bytes32 marketId, address user)
        external
        view
        override
        returns (bool pending, uint256 principal)
    {
        return _rageQuitSettlementPending(user, marketId);
    }

    function rageQuitRewardCutoff(bytes32 marketId, address user)
        external
        view
        override
        returns (uint256 principal, uint256 quoteAccumulator, uint256 memeAccumulator, bool forfeitureRedistributable)
    {
        return _rageQuitRewardCutoff(user, marketId);
    }

    function rewardEligibleActiveStock(bytes32 marketId) external view override returns (uint256) {
        return _rewardEligibleActiveStock(marketId);
    }

    function recordGaugeRewardState(bytes32 marketId, uint256 quoteAccumulator, uint256 memeAccumulator)
        external
        override
    {
        _recordGaugeRewardState(marketId, quoteAccumulator, memeAccumulator);
    }

    function depositAndAllocate(bytes32 marketId, uint256 depositAmount, uint256 allocationAmount) external override {
        _depositAndAllocate(msg.sender, marketId, depositAmount, allocationAmount);
    }
}
