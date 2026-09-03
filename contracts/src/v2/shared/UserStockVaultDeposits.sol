// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {AssetView} from "../interfaces/IV2Protocol.sol";
import {UserStockVaultIdentity} from "./UserStockVaultIdentity.sol";

/// @notice Exact-arrival STOCK deposit accounting isolated by canonical Asset UID.
abstract contract UserStockVaultDeposits is UserStockVaultIdentity, ReentrancyGuard {
    mapping(bytes32 assetUid => mapping(address user => uint256 amount)) internal _deposited;
    mapping(bytes32 assetUid => uint256 amount) internal _totalDeposited;

    error InvalidDepositAccount(address user);
    error InvalidDepositAmount(uint256 amount);
    error StockTransferCallFailed(address stockToken);
    error InvalidStockTransferReturn(address stockToken);
    error InexactStockBalanceDelta(address stockToken, uint256 expected, uint256 actual);

    constructor(address officialStockRegistry_, address marketRegistry_, address allocationManager_)
        UserStockVaultIdentity(officialStockRegistry_, marketRegistry_, allocationManager_)
    {}

    function _depositStock(bytes32 assetUid, address user, uint256 amount) internal nonReentrant {
        if (user == address(0) || user == address(this)) revert InvalidDepositAccount(user);
        if (amount == 0) revert InvalidDepositAmount(amount);
        AssetView memory assetView = _activeCanonicalAsset(assetUid);
        IERC20 stockToken = IERC20(assetView.stockToken);

        uint256 beforeBalance = stockToken.balanceOf(address(this));
        (bool success, bytes memory result) =
            address(stockToken).call(abi.encodeCall(IERC20.transferFrom, (user, address(this), amount)));
        if (!success) revert StockTransferCallFailed(address(stockToken));
        if (result.length != 32 || abi.decode(result, (uint256)) != 1) {
            revert InvalidStockTransferReturn(address(stockToken));
        }

        uint256 afterBalance = stockToken.balanceOf(address(this));
        uint256 received = afterBalance >= beforeBalance ? afterBalance - beforeBalance : type(uint256).max;
        if (received != amount) revert InexactStockBalanceDelta(address(stockToken), amount, received);

        _deposited[assetUid][user] += amount;
        _totalDeposited[assetUid] += amount;
    }
}
