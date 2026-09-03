// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IAllocationManager} from "../interfaces/IV2Protocol.sol";
import {AllocationManagerMigrations} from "../shared/AllocationManagerMigrations.sol";

/// @notice Canonical caller-bound coordinator for Vault allocation and per-market Gauge weight.
contract AllocationManager is IAllocationManager, AllocationManagerMigrations {
    constructor(address officialStockRegistry_, address marketRegistry_)
        AllocationManagerMigrations(officialStockRegistry_, marketRegistry_)
    {}

    function allocate(bytes32 marketId, uint256 amount) external override {
        _increaseAllocation(msg.sender, marketId, amount);
    }

    function increaseAllocation(bytes32 marketId, uint256 amount) external override {
        _increaseAllocation(msg.sender, marketId, amount);
    }

    function decreaseAllocation(bytes32 marketId, uint256 amount) external override {
        _decreaseAllocation(msg.sender, marketId, amount, false);
    }

    function closeAllocation(bytes32 marketId) external override {
        _decreaseAllocation(msg.sender, marketId, 0, true);
    }

    function migrateAllocation(bytes32 fromMarketId, bytes32 toMarketId, uint256 amount) external override {
        (uint256 sourceRemaining, uint64 targetPendingGeneration, uint64 targetUnlockAt) =
            _migrateAllocation(msg.sender, fromMarketId, toMarketId, amount);
        emit AllocationMigrated(
            msg.sender, fromMarketId, toMarketId, amount, sourceRemaining, targetPendingGeneration, targetUnlockAt
        );
    }

    function depositAndAllocate(bytes32 marketId, uint256 depositAmount, uint256 allocationAmount) external override {
        _depositAndAllocate(msg.sender, marketId, depositAmount, allocationAmount);
    }
}
