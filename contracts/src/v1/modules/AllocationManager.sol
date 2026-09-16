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

    /// @notice Stake wallet-owned STOCK directly into one market.
    function stake(bytes32 marketId, uint256 amount) external override {
        _depositAndAllocate(msg.sender, marketId, amount, amount);
    }

    /// @notice Return the entire unlocked principal to the caller, preserving claimable rewards.
    function unstakeAndWithdraw(bytes32 marketId) external override {
        _unstakeAndWithdraw(msg.sender, marketId);
    }

    function closeAllocation(bytes32 marketId) external override {
        _closeAllocation(msg.sender, marketId);
    }

    function rageQuit(bytes32 marketId) external override nonReentrant {
        (
            uint256 principal,
            uint256 quoteForfeited,
            uint256 memeForfeited,
            bool rewardSettlementCompleted,
            address gauge
        ) = _rageQuitAllocationWithSettlement(msg.sender, marketId);
        emit AllocationRageQuitExecuted(msg.sender, marketId, principal, quoteForfeited, memeForfeited);
        if (rewardSettlementCompleted) {
            emit RageQuitRewardSettlementFinalized(msg.sender, marketId, principal, quoteForfeited, memeForfeited);
        } else {
            emit RageQuitRewardSettlementDeferred(msg.sender, marketId, principal, gauge);
        }
    }

    function settleRageQuitRewards(bytes32 marketId, address user)
        external
        override
        returns (uint256 quoteForfeited, uint256 memeForfeited)
    {
        uint256 principal;
        (principal, quoteForfeited, memeForfeited) = _settleRageQuitRewards(user, marketId);
        emit RageQuitRewardSettlementFinalized(user, marketId, principal, quoteForfeited, memeForfeited);
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
        returns (uint256 principal, uint256 quoteAccumulator, uint256 memeAccumulator)
    {
        return _rageQuitRewardCutoff(user, marketId);
    }

    function rewardEligibleActiveStock(bytes32 marketId) external view override returns (uint256) {
        return _rewardEligibleActiveStock(marketId);
    }

    function rewardCohortEpoch(bytes32 marketId) external view override returns (uint256) {
        ExitContext memory context = _rageQuitContext(marketId);
        return context.vault.marketRewardCohortEpoch(context.assetUid, marketId);
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

    function officialStockRegistry() external view override returns (address) {
        return address(_officialStockRegistry);
    }

    function marketRegistry() external view override returns (address) {
        return address(_marketRegistry);
    }
}
