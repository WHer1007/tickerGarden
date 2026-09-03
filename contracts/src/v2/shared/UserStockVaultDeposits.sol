// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {UserStockVaultIdentity} from "./UserStockVaultIdentity.sol";

/// @notice Exact-arrival STOCK deposit accounting reused by the final per-asset UserStockVault.
abstract contract UserStockVaultDeposits is UserStockVaultIdentity, ReentrancyGuard {
    mapping(address user => uint256 amount) internal _deposited;
    uint256 internal _totalDeposited;

    error InvalidDepositAccount(address user);
    error InvalidDepositAmount(uint256 amount);
    error StockTransferCallFailed(address stockToken);
    error InvalidStockTransferReturn(address stockToken);
    error InexactStockBalanceDelta(address stockToken, uint256 expected, uint256 actual);

    constructor(
        address officialStockRegistry_,
        address marketRegistry_,
        address allocationManager_,
        bytes32 assetUid_,
        address stockToken_
    ) UserStockVaultIdentity(officialStockRegistry_, marketRegistry_, allocationManager_, assetUid_, stockToken_) {}

    function _depositStock(address user, uint256 amount) internal nonReentrant {
        if (user == address(0) || user == address(this)) revert InvalidDepositAccount(user);
        if (amount == 0) revert InvalidDepositAmount(amount);
        _activeCanonicalAsset();

        uint256 beforeBalance = _stockToken.balanceOf(address(this));
        (bool success, bytes memory result) =
            address(_stockToken).call(abi.encodeCall(IERC20.transferFrom, (user, address(this), amount)));
        if (!success) revert StockTransferCallFailed(address(_stockToken));
        if (result.length != 32 || abi.decode(result, (uint256)) != 1) {
            revert InvalidStockTransferReturn(address(_stockToken));
        }

        uint256 afterBalance = _stockToken.balanceOf(address(this));
        uint256 received = afterBalance >= beforeBalance ? afterBalance - beforeBalance : type(uint256).max;
        if (received != amount) revert InexactStockBalanceDelta(address(_stockToken), amount, received);

        _deposited[user] += amount;
        _totalDeposited += amount;
    }
}
