// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {AssetView} from "../interfaces/IV1Protocol.sol";
import {UserStockVaultLedger} from "./UserStockVaultLedger.sol";

/// @notice User-only free-principal withdrawal and principal-first rage-quit release.
abstract contract UserStockVaultExits is UserStockVaultLedger {
    error InvalidWithdrawalAmount(uint256 amount);
    error InsufficientFreeBalance(uint256 requested, uint256 available);
    error StockWithdrawalCallFailed(address stockToken);
    error InvalidStockWithdrawalReturn(address stockToken);
    error InexactStockWithdrawalDelta(
        address stockToken, uint256 expected, uint256 vaultDecrease, uint256 userIncrease
    );
    constructor(address officialStockRegistry_, address marketRegistry_, address allocationManager_)
        UserStockVaultLedger(officialStockRegistry_, marketRegistry_, allocationManager_)
    {}

    function _withdrawFreeStock(bytes32 assetUid, address user, uint256 amount) internal nonReentrant {
        _withdrawFreeStockUnchecked(assetUid, user, amount);
    }

    function _releaseAllocationAndWithdraw(bytes32 assetUid, address user, bytes32 marketId)
        internal
        nonReentrant
        returns (uint256 amount)
    {
        amount = _releaseAllocation(assetUid, user, marketId);
        _withdrawFreeStockUnchecked(assetUid, user, amount);
    }

    function _withdrawFreeStockUnchecked(bytes32 assetUid, address user, uint256 amount) private {
        if (amount == 0) revert InvalidWithdrawalAmount(amount);
        AssetView memory assetView = _canonicalAsset(assetUid);
        IERC20 stockToken = IERC20(assetView.stockToken);

        uint256 available = _freeBalanceOf(assetUid, user);
        if (amount > available) revert InsufficientFreeBalance(amount, available);

        _deposited[assetUid][user] -= amount;
        _totalDeposited[assetUid] -= amount;

        uint256 vaultBalanceBefore = stockToken.balanceOf(address(this));
        uint256 userBalanceBefore = stockToken.balanceOf(user);
        (bool success, bytes memory result) = address(stockToken).call(abi.encodeCall(IERC20.transfer, (user, amount)));
        if (!success) revert StockWithdrawalCallFailed(address(stockToken));
        if (result.length != 32 || abi.decode(result, (uint256)) != 1) {
            revert InvalidStockWithdrawalReturn(address(stockToken));
        }

        uint256 vaultBalanceAfter = stockToken.balanceOf(address(this));
        uint256 userBalanceAfter = stockToken.balanceOf(user);
        uint256 vaultDecrease =
            vaultBalanceBefore >= vaultBalanceAfter ? vaultBalanceBefore - vaultBalanceAfter : type(uint256).max;
        uint256 userIncrease =
            userBalanceAfter >= userBalanceBefore ? userBalanceAfter - userBalanceBefore : type(uint256).max;
        if (vaultDecrease != amount || userIncrease != amount) {
            revert InexactStockWithdrawalDelta(address(stockToken), amount, vaultDecrease, userIncrease);
        }
    }

    /// @dev The only mandatory rage-quit work is the Vault ledger update plus exact STOCK transfer. Reward
    ///      settlement is acknowledged separately by the immutable AllocationManager and can never roll this
    ///      principal path back after the transaction succeeds.
    function _rageQuitAndWithdraw(bytes32 assetUid, address user, bytes32 marketId)
        internal
        nonReentrant
        returns (uint256 amount)
    {
        amount = _rageQuitAllocationLedger(assetUid, user, marketId);
        _withdrawFreeStockUnchecked(assetUid, user, amount);
    }
}
