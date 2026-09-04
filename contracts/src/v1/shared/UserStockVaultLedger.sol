// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {UserStockVaultRewardAccounting} from "./UserStockVaultRewardAccounting.sol";

/// @notice Authoritative free, user-market, and market-total STOCK allocation accounting.
/// @dev Market lifecycle and Gauge position checks belong to AllocationManager. This layer only accepts
///      calls from that immutable manager and preserves the Vault's principal-occupancy equations.
abstract contract UserStockVaultLedger is UserStockVaultRewardAccounting {
    mapping(bytes32 assetUid => mapping(address user => uint256 amount)) internal _allocated;
    mapping(bytes32 assetUid => mapping(address user => mapping(bytes32 marketId => uint256 amount))) internal
        _allocation;
    mapping(bytes32 assetUid => mapping(bytes32 marketId => uint256 amount)) internal _marketAllocated;
    mapping(bytes32 assetUid => uint256 amount) internal _totalAllocated;
    mapping(bytes32 assetUid => mapping(address user => mapping(bytes32 marketId => uint256 principal))) internal
        _rageQuitSettlementPrincipals;

    error InvalidAllocationAccount(address user);
    error InvalidAllocationAmount(uint256 amount);
    error AllocationExceedsDeposit(uint256 requested, uint256 freeBalance);
    error InsufficientMarketAllocation(bytes32 marketId, uint256 requested, uint256 available);
    error NoMarketAllocation(address user, bytes32 marketId);
    error AllocationLedgerMismatch();
    error RageQuitRewardSettlementPending(address user, bytes32 marketId, uint256 principal);
    error NoRageQuitRewardSettlement(address user, bytes32 marketId);

    constructor(address officialStockRegistry_, address marketRegistry_, address allocationManager_)
        UserStockVaultRewardAccounting(officialStockRegistry_, marketRegistry_, allocationManager_)
    {}

    function _lockAllocation(bytes32 assetUid, address user, bytes32 marketId, uint256 amount) internal {
        _validateAccountAndAmount(user, amount);
        _canonicalMarket(assetUid, marketId);

        uint256 pendingPrincipal = _rageQuitSettlementPrincipals[assetUid][user][marketId];
        if (pendingPrincipal != 0) {
            revert RageQuitRewardSettlementPending(user, marketId, pendingPrincipal);
        }

        uint256 freeBalance = _freeBalanceOf(assetUid, user);
        if (amount > freeBalance) revert AllocationExceedsDeposit(amount, freeBalance);

        _lockRewardEligibility(assetUid, user, marketId, amount);
        _allocation[assetUid][user][marketId] += amount;
        _allocated[assetUid][user] += amount;
        _marketAllocated[assetUid][marketId] += amount;
        _totalAllocated[assetUid] += amount;
    }

    function _releaseAllocation(bytes32 assetUid, address user, bytes32 marketId) internal returns (uint256 amount) {
        if (user == address(0) || user == address(this)) revert InvalidAllocationAccount(user);
        _canonicalMarket(assetUid, marketId);

        amount = _allocation[assetUid][user][marketId];
        if (amount == 0) revert NoMarketAllocation(user, marketId);

        _removeRewardEligibility(assetUid, user, marketId, amount);
        _allocation[assetUid][user][marketId] = 0;
        _allocated[assetUid][user] -= amount;
        _marketAllocated[assetUid][marketId] -= amount;
        _totalAllocated[assetUid] -= amount;
    }

    /// @dev Principal-first escape accounting. A non-zero stored allocation proves that the canonical
    ///      asset/market binding was validated when the position was opened, so this path deliberately avoids
    ///      consulting mutable market lifecycle state. The canonical asset lookup remains necessary only to
    ///      resolve the write-once STOCK token used by the exact outbound transfer.
    function _rageQuitAllocationLedger(bytes32 assetUid, address user, bytes32 marketId)
        internal
        returns (uint256 amount)
    {
        if (user == address(0) || user == address(this)) revert InvalidAllocationAccount(user);
        if (marketId == bytes32(0)) revert InvalidMarketId(marketId);
        _canonicalAsset(assetUid);

        amount = _allocation[assetUid][user][marketId];
        if (amount == 0) revert NoMarketAllocation(user, marketId);

        uint256 pendingPrincipal = _rageQuitSettlementPrincipals[assetUid][user][marketId];
        if (pendingPrincipal != 0) {
            revert RageQuitRewardSettlementPending(user, marketId, pendingPrincipal);
        }

        // The tombstone is written before any external token call. If the transfer fails, EVM atomicity rolls
        // this marker and every principal-ledger write back together.
        _removeRewardEligibility(assetUid, user, marketId, amount);
        _snapshotRageQuitRewardCutoff(assetUid, user, marketId);
        _rageQuitSettlementPrincipals[assetUid][user][marketId] = amount;
        _allocation[assetUid][user][marketId] = 0;
        _allocated[assetUid][user] -= amount;
        _marketAllocated[assetUid][marketId] -= amount;
        _totalAllocated[assetUid] -= amount;
    }

    function _completeRageQuitRewardSettlement(bytes32 assetUid, address user, bytes32 marketId)
        internal
        returns (uint256 principal)
    {
        principal = _rageQuitSettlementPrincipals[assetUid][user][marketId];
        if (principal == 0) revert NoRageQuitRewardSettlement(user, marketId);
        delete _rageQuitSettlementPrincipals[assetUid][user][marketId];
        _clearRageQuitRewardCutoff(assetUid, user, marketId);
    }

    function _rageQuitSettlementPrincipal(bytes32 assetUid, address user, bytes32 marketId)
        internal
        view
        returns (uint256)
    {
        return _rageQuitSettlementPrincipals[assetUid][user][marketId];
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
