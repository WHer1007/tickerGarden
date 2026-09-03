// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {UserStockVaultDeposits} from "./UserStockVaultDeposits.sol";

/// @notice Authoritative free, user-market, and market-total STOCK allocation accounting.
/// @dev Market lifecycle and Gauge position checks belong to AllocationManager. This layer only accepts
///      calls from that immutable manager and preserves the Vault's principal-occupancy equations.
abstract contract UserStockVaultLedger is UserStockVaultDeposits {
    mapping(bytes32 assetUid => mapping(address user => uint256 amount)) internal _allocated;
    mapping(bytes32 assetUid => mapping(address user => mapping(bytes32 marketId => uint256 amount))) internal
        _allocation;
    mapping(bytes32 assetUid => mapping(bytes32 marketId => uint256 amount)) internal _marketAllocated;
    mapping(bytes32 assetUid => uint256 amount) internal _totalAllocated;

    error InvalidAllocationAccount(address user);
    error InvalidAllocationAmount(uint256 amount);
    error AllocationExceedsDeposit(uint256 requested, uint256 freeBalance);
    error InsufficientMarketAllocation(bytes32 marketId, uint256 requested, uint256 available);
    error NoMarketAllocation(address user, bytes32 marketId);
    error AllocationLedgerMismatch();

    constructor(address officialStockRegistry_, address marketRegistry_, address allocationManager_)
        UserStockVaultDeposits(officialStockRegistry_, marketRegistry_, allocationManager_)
    {}

    function _lockAllocation(bytes32 assetUid, address user, bytes32 marketId, uint256 amount) internal {
        _validateAccountAndAmount(user, amount);
        _canonicalMarket(assetUid, marketId);

        uint256 freeBalance = _freeBalanceOf(assetUid, user);
        if (amount > freeBalance) revert AllocationExceedsDeposit(amount, freeBalance);

        _allocation[assetUid][user][marketId] += amount;
        _allocated[assetUid][user] += amount;
        _marketAllocated[assetUid][marketId] += amount;
        _totalAllocated[assetUid] += amount;
    }

    function _releaseAllocation(bytes32 assetUid, address user, bytes32 marketId)
        internal
        returns (uint256 amount)
    {
        if (user == address(0) || user == address(this)) revert InvalidAllocationAccount(user);
        _canonicalMarket(assetUid, marketId);

        amount = _allocation[assetUid][user][marketId];
        if (amount == 0) revert NoMarketAllocation(user, marketId);

        _allocation[assetUid][user][marketId] = 0;
        _allocated[assetUid][user] -= amount;
        _marketAllocated[assetUid][marketId] -= amount;
        _totalAllocated[assetUid] -= amount;
    }

    function _freeBalanceOf(bytes32 assetUid, address user) internal view returns (uint256) {
        uint256 depositedAmount = _deposited[assetUid][user];
        uint256 allocatedAmount = _allocated[assetUid][user];
        if (allocatedAmount > depositedAmount) revert AllocationLedgerMismatch();
        return depositedAmount - allocatedAmount;
    }

    function _validateAccountAndAmount(address user, uint256 amount) private view {
        if (user == address(0) || user == address(this)) revert InvalidAllocationAccount(user);
        if (amount == 0) revert InvalidAllocationAmount(amount);
    }
}
