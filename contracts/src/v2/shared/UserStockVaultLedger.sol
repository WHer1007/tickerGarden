// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {UserStockVaultDeposits} from "./UserStockVaultDeposits.sol";

/// @notice Authoritative free, user-market, and market-total STOCK allocation accounting.
/// @dev Market lifecycle and Gauge position checks belong to AllocationManager. This layer only accepts
///      calls from that immutable manager and preserves the Vault's principal-occupancy equations.
abstract contract UserStockVaultLedger is UserStockVaultDeposits {
    mapping(address user => uint256 amount) internal _allocated;
    mapping(address user => mapping(bytes32 marketId => uint256 amount)) internal _allocation;
    mapping(bytes32 marketId => uint256 amount) internal _marketAllocated;
    uint256 internal _totalAllocated;

    error InvalidAllocationAccount(address user);
    error InvalidAllocationAmount(uint256 amount);
    error AllocationExceedsDeposit(uint256 requested, uint256 freeBalance);
    error InsufficientMarketAllocation(bytes32 marketId, uint256 requested, uint256 available);
    error SameAllocationMarket(bytes32 marketId);
    error AllocationLedgerMismatch();

    constructor(
        address officialStockRegistry_,
        address marketRegistry_,
        address allocationManager_,
        bytes32 assetUid_,
        address stockToken_
    ) UserStockVaultDeposits(officialStockRegistry_, marketRegistry_, allocationManager_, assetUid_, stockToken_) {}

    function _lockAllocation(address user, bytes32 marketId, uint256 amount) internal {
        _validateAccountAndAmount(user, amount);
        _canonicalMarket(marketId);

        uint256 freeBalance = _freeBalanceOf(user);
        if (amount > freeBalance) revert AllocationExceedsDeposit(amount, freeBalance);

        _allocation[user][marketId] += amount;
        _allocated[user] += amount;
        _marketAllocated[marketId] += amount;
        _totalAllocated += amount;
    }

    function _releaseAllocation(address user, bytes32 marketId, uint256 amount) internal {
        _validateAccountAndAmount(user, amount);
        _canonicalMarket(marketId);

        uint256 available = _allocation[user][marketId];
        if (amount > available) revert InsufficientMarketAllocation(marketId, amount, available);

        _allocation[user][marketId] = available - amount;
        _allocated[user] -= amount;
        _marketAllocated[marketId] -= amount;
        _totalAllocated -= amount;
    }

    function _moveAllocation(address user, bytes32 fromMarketId, bytes32 toMarketId, uint256 amount) internal {
        _validateAccountAndAmount(user, amount);
        if (fromMarketId == toMarketId) revert SameAllocationMarket(fromMarketId);
        _canonicalMarket(fromMarketId);
        _canonicalMarket(toMarketId);

        uint256 available = _allocation[user][fromMarketId];
        if (amount > available) revert InsufficientMarketAllocation(fromMarketId, amount, available);

        _allocation[user][fromMarketId] = available - amount;
        _allocation[user][toMarketId] += amount;
        _marketAllocated[fromMarketId] -= amount;
        _marketAllocated[toMarketId] += amount;
    }

    function _freeBalanceOf(address user) internal view returns (uint256) {
        uint256 depositedAmount = _deposited[user];
        uint256 allocatedAmount = _allocated[user];
        if (allocatedAmount > depositedAmount) revert AllocationLedgerMismatch();
        return depositedAmount - allocatedAmount;
    }

    function _validateAccountAndAmount(address user, uint256 amount) private view {
        if (user == address(0) || user == address(this)) revert InvalidAllocationAccount(user);
        if (amount == 0) revert InvalidAllocationAmount(amount);
    }
}
