// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IUserStockVault} from "../interfaces/IV1Protocol.sol";
import {UserStockVaultExits} from "../shared/UserStockVaultExits.sol";

/// @notice Versioned multi-asset canonical STOCK custody and allocation-principal ledger.
contract UserStockVault is IUserStockVault, UserStockVaultExits {
    constructor(address officialStockRegistry_, address marketRegistry_, address allocationManager_)
        UserStockVaultExits(officialStockRegistry_, marketRegistry_, allocationManager_)
    {}

    function depositStock(bytes32 assetUid, uint256 amount) external override {
        _depositStock(assetUid, msg.sender, amount);
        emit StockDeposited(assetUid, msg.sender, amount);
    }

    function depositStockFor(bytes32 assetUid, address user, uint256 amount) external override onlyAllocationManager {
        _depositStock(assetUid, user, amount);
        emit StockDeposited(assetUid, user, amount);
    }

    function withdrawFreeStock(bytes32 assetUid, uint256 amount) external override {
        _withdrawFreeStock(assetUid, msg.sender, amount);
        emit StockWithdrawn(assetUid, msg.sender, amount);
    }

    /// @notice Caller-only unconditional principal escape. It ignores lock time and minimum allocation,
    ///         forfeits all rewards through an immediately visible settlement tombstone, and returns the
    ///         complete allocated STOCK principal to the caller in this transaction.
    function rageQuit(bytes32 assetUid, bytes32 marketId) external override returns (uint256 amount) {
        amount = _rageQuitAndWithdraw(assetUid, msg.sender, marketId);
        emit AllocationReleased(assetUid, msg.sender, marketId, amount, 0, _allocated[assetUid][msg.sender]);
        emit StockWithdrawn(assetUid, msg.sender, amount);
        emit AllocationRageQuit(assetUid, msg.sender, marketId, amount);
        emit RageQuitRewardSettlementQueued(assetUid, msg.sender, marketId, amount);
    }

    function lockAllocation(bytes32 assetUid, address user, bytes32 marketId, uint256 amount)
        external
        override
        onlyAllocationManager
        nonReentrant
    {
        _lockAllocation(assetUid, user, marketId, amount);
        emit AllocationLocked(
            assetUid, user, marketId, amount, _allocation[assetUid][user][marketId], _allocated[assetUid][user]
        );
    }

    function releaseAllocation(bytes32 assetUid, address user, bytes32 marketId)
        external
        override
        onlyAllocationManager
        nonReentrant
        returns (uint256 amount)
    {
        amount = _releaseAllocation(assetUid, user, marketId);
        emit AllocationReleased(
            assetUid, user, marketId, amount, _allocation[assetUid][user][marketId], _allocated[assetUid][user]
        );
    }

    function rageQuitAllocation(bytes32 assetUid, address user, bytes32 marketId)
        external
        override
        onlyAllocationManager
        returns (uint256 amount)
    {
        amount = _rageQuitAndWithdraw(assetUid, user, marketId);
        emit AllocationReleased(
            assetUid, user, marketId, amount, _allocation[assetUid][user][marketId], _allocated[assetUid][user]
        );
        emit StockWithdrawn(assetUid, user, amount);
        emit AllocationRageQuit(assetUid, user, marketId, amount);
        emit RageQuitRewardSettlementQueued(assetUid, user, marketId, amount);
    }

    function completeRageQuitRewardSettlement(bytes32 assetUid, address user, bytes32 marketId)
        external
        override
        onlyAllocationManager
        nonReentrant
        returns (uint256 principal)
    {
        principal = _completeRageQuitRewardSettlement(assetUid, user, marketId);
        emit RageQuitRewardSettlementCompleted(assetUid, user, marketId, principal);
    }

    function deposited(bytes32 assetUid, address user) external view override returns (uint256) {
        return _deposited[assetUid][user];
    }

    function allocated(bytes32 assetUid, address user) external view override returns (uint256) {
        return _allocated[assetUid][user];
    }

    function allocation(bytes32 assetUid, address user, bytes32 marketId) external view override returns (uint256) {
        return _allocation[assetUid][user][marketId];
    }

    function rageQuitSettlementPrincipal(bytes32 assetUid, address user, bytes32 marketId)
        external
        view
        override
        returns (uint256)
    {
        return _rageQuitSettlementPrincipal(assetUid, user, marketId);
    }

    function freeBalanceOf(bytes32 assetUid, address user) external view override returns (uint256) {
        return _freeBalanceOf(assetUid, user);
    }

    function marketAllocated(bytes32 assetUid, bytes32 marketId) external view override returns (uint256) {
        return _marketAllocated[assetUid][marketId];
    }

    function totalDeposited(bytes32 assetUid) external view override returns (uint256) {
        return _totalDeposited[assetUid];
    }

    function totalAllocated(bytes32 assetUid) external view override returns (uint256) {
        return _totalAllocated[assetUid];
    }

    function vaultIdentity()
        external
        view
        override
        returns (address officialStockRegistry, address marketRegistry, address allocationManager, bytes32 schemaId)
    {
        return (address(_officialStockRegistry), address(_marketRegistry), _allocationManager, VAULT_SCHEMA_ID);
    }
}
