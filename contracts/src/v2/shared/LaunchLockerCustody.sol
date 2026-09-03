// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {MarketView, PoolKey} from "../interfaces/IV2Protocol.sol";
import {LaunchLockerBinding} from "./LaunchLockerBinding.sol";

/// @notice Permanent two-currency custody boundary shared by the final per-market LaunchLocker.
/// @dev This layer intentionally has no asset/NFT transfer, approval, arbitrary-call, admin, or initialization entry.
///      C304-B may only compound balances back into the position already frozen by LaunchLockerBinding.
abstract contract LaunchLockerCustody is LaunchLockerBinding {
    address internal immutable _lockerCurrency0;
    address internal immutable _lockerCurrency1;

    error InvalidLaunchLockerPoolKey(bytes32 marketId, bytes32 suppliedPoolId, bytes32 expectedPoolId);
    error UnsupportedLaunchLockerCurrency(address currency);
    error UnexpectedNativeLaunchLockerValue(address currency0, uint256 amount);

    constructor(bytes32 marketId_, address marketRegistry_, address positionManager_)
        LaunchLockerBinding(marketId_, marketRegistry_, positionManager_)
    {
        MarketView memory marketView = _lockerMarketRegistry.market(marketId_);
        PoolKey memory key = _lockerMarketRegistry.canonicalPoolKey(marketId_);
        (address expectedCurrency0, address expectedCurrency1) = marketView.config.quoteAsset
            < marketView.config.memeToken
            ? (marketView.config.quoteAsset, marketView.config.memeToken)
            : (marketView.config.memeToken, marketView.config.quoteAsset);
        (bytes32 boundMarketId,, bytes32 boundPoolId) = _lockedPositionIdentity();
        bytes32 suppliedPoolId = keccak256(abi.encode(key));
        if (
            boundMarketId != marketId_ || key.currency0 != expectedCurrency0 || key.currency1 != expectedCurrency1
                || key.currency0 >= key.currency1 || key.fee != 0 || key.hooks != marketView.config.graduatedHook
                || suppliedPoolId != boundPoolId
        ) revert InvalidLaunchLockerPoolKey(marketId_, suppliedPoolId, boundPoolId);

        _lockerCurrency0 = key.currency0;
        _lockerCurrency1 = key.currency1;
    }

    receive() external payable {
        if (_lockerCurrency0 != address(0)) {
            revert UnexpectedNativeLaunchLockerValue(_lockerCurrency0, msg.value);
        }
    }

    function unpairedLockedBalance(address currency) public view returns (uint256) {
        _requireLockerCurrency(currency);
        if (currency == address(0)) return address(this).balance;
        return IERC20(currency).balanceOf(address(this));
    }

    function _lockedCurrencies() internal view returns (address currency0, address currency1) {
        return (_lockerCurrency0, _lockerCurrency1);
    }

    function _requireLockerCurrency(address currency) internal view {
        if (currency != _lockerCurrency0 && currency != _lockerCurrency1) {
            revert UnsupportedLaunchLockerCurrency(currency);
        }
    }
}
