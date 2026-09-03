// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {AllocationManagerDecreases} from "./AllocationManagerDecreases.sol";

/// @notice Shared caller-bound deposit-and-allocate path for the final AllocationManager.
/// @dev The canonical Vault pulls STOCK directly from `user`; the Manager never receives principal or approval.
abstract contract AllocationManagerDeposits is AllocationManagerDecreases {
    constructor(address officialStockRegistry_, address marketRegistry_)
        AllocationManagerDecreases(officialStockRegistry_, marketRegistry_)
    {}

    function _depositAndAllocate(address user, bytes32 marketId, uint256 depositAmount, uint256 allocationAmount)
        internal
        nonReentrant
    {
        _validateAllocationRequest(user, allocationAmount);

        IncreaseContext memory context = _openAllocationMarket(marketId);
        (context.activationAt, context.unlockAt) = _allocationTimes();

        // Vault performs the exact-arrival check and pulls directly from the same outer caller.
        context.vault.depositStockFor(context.assetUid, user, depositAmount);

        _executeIncrease(user, marketId, allocationAmount, context);
    }
}
