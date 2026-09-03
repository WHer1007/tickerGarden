// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IUserStockVault} from "../interfaces/IV2Protocol.sol";
import {UserStockVaultExits} from "../shared/UserStockVaultExits.sol";

/// @notice Per-asset canonical STOCK custody and allocation-principal ledger.
contract UserStockVault is IUserStockVault, UserStockVaultExits {
    constructor(
        address officialStockRegistry_,
        address marketRegistry_,
        address allocationManager_,
        bytes32 assetUid_,
        address stockToken_
    ) UserStockVaultExits(officialStockRegistry_, marketRegistry_, allocationManager_, assetUid_, stockToken_) {}

    function depositStock(uint256 amount) external override {
        _depositStock(msg.sender, amount);
        emit StockDeposited(_assetUid, msg.sender, amount);
    }

    function depositStockFor(address user, uint256 amount) external override onlyAllocationManager {
        _depositStock(user, amount);
        emit StockDeposited(_assetUid, user, amount);
    }

    function withdrawFreeStock(uint256 amount) external override {
        _withdrawFreeStock(msg.sender, amount);
        emit StockWithdrawn(_assetUid, msg.sender, amount);
    }

    function forceReleaseAllocation(bytes32 marketId) external override returns (uint256 amount) {
        uint32 recoveryEpoch;
        (amount, recoveryEpoch) = _forceReleaseAllocation(msg.sender, marketId);
        emit AllocationForceReleased(msg.sender, marketId, amount, recoveryEpoch);
    }

    function lockAllocation(address user, bytes32 marketId, uint256 amount) external override onlyAllocationManager {
        _lockAllocation(user, marketId, amount);
        emit AllocationLocked(user, marketId, amount, _allocation[user][marketId], _allocated[user]);
    }

    function releaseAllocation(address user, bytes32 marketId, uint256 amount) external override onlyAllocationManager {
        _releaseAllocation(user, marketId, amount);
        emit AllocationReleased(user, marketId, amount, _allocation[user][marketId], _allocated[user]);
    }

    function moveAllocation(address user, bytes32 fromMarketId, bytes32 toMarketId, uint256 amount)
        external
        override
        onlyAllocationManager
    {
        _moveAllocation(user, fromMarketId, toMarketId, amount);
        emit AllocationMoved(user, fromMarketId, toMarketId, amount);
    }

    function deposited(address user) external view override returns (uint256) {
        return _deposited[user];
    }

    function allocated(address user) external view override returns (uint256) {
        return _allocated[user];
    }

    function allocation(address user, bytes32 marketId) external view override returns (uint256) {
        return _allocation[user][marketId];
    }

    function freeBalanceOf(address user) external view override returns (uint256) {
        return _freeBalanceOf(user);
    }

    function marketAllocated(bytes32 marketId) external view override returns (uint256) {
        return _marketAllocated[marketId];
    }

    function totalDeposited() external view override returns (uint256) {
        return _totalDeposited;
    }

    function totalAllocated() external view override returns (uint256) {
        return _totalAllocated;
    }
}
