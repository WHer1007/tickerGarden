// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IAllocationManager} from "../interfaces/IV2Protocol.sol";
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

    function rageQuit(bytes32 marketId) external override {
        (uint256 principal, uint256 quoteForfeited, uint256 memeForfeited, bool redistributed) =
            _rageQuitAllocation(msg.sender, marketId);
        emit AllocationRageQuitExecuted(msg.sender, marketId, principal, quoteForfeited, memeForfeited, redistributed);
    }

    function depositAndAllocate(bytes32 marketId, uint256 depositAmount, uint256 allocationAmount) external override {
        _depositAndAllocate(msg.sender, marketId, depositAmount, allocationAmount);
    }
}
