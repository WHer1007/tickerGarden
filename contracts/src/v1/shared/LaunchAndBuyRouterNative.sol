// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {
    CreateMarketParams,
    IApprovedQuoteRegistry,
    IPonsCompatibleCurve,
    ITickerGardenFactoryV1,
    QuoteAssetConfig
} from "../interfaces/IV1Protocol.sol";

interface ILaunchFactoryDependencies {
    function approvedQuoteRegistry() external view returns (IApprovedQuoteRegistry);
}

/// @notice Native-Quote atomic launch-and-buy composition shared by the final LaunchAndBuyRouter.
abstract contract LaunchAndBuyRouterNative is ReentrancyGuard {
    uint8 private constant CONFIG_STATUS_ACTIVE = 1;

    ITickerGardenFactoryV1 internal immutable _launchFactory;
    IApprovedQuoteRegistry internal immutable _approvedQuoteRegistry;
    address private _nativeRefundSource;

    error InvalidLaunchRouterDependency(address dependency);
    error LaunchFactoryRegistryMismatch(address expected, address actual);
    error InvalidFirstBuyAmount(uint256 amount);
    error InvalidFirstBuyRecipient(address recipient);
    error QuoteConfigNotActive(bytes32 quoteAssetConfigId, uint8 status);
    error NativeQuoteRequired(bytes32 quoteAssetConfigId, address quoteAsset);
    error InvalidLaunchAndBuyValue(uint256 expected, uint256 actual);
    error InvalidCreatedMarket(bytes32 marketId, address memeToken, address curve);
    error InvalidQuoteSpent(uint256 firstBuyAmount, uint256 quoteSpent);
    error NativeRefundBalanceMismatch(uint256 expected, uint256 actual);
    error UnauthorizedNativeRefund(address caller, address expected);
    error NativeRefundTransferFailed(address creator, uint256 amount);

    constructor(address factory_, address approvedQuoteRegistry_) {
        if (factory_ == address(0)) revert InvalidLaunchRouterDependency(factory_);
        if (
            approvedQuoteRegistry_ == address(0) || factory_ == approvedQuoteRegistry_
                || approvedQuoteRegistry_.code.length == 0
        ) revert InvalidLaunchRouterDependency(approvedQuoteRegistry_);
        _launchFactory = ITickerGardenFactoryV1(factory_);
        _approvedQuoteRegistry = IApprovedQuoteRegistry(approvedQuoteRegistry_);
    }

    receive() external payable {
        if (msg.sender != _nativeRefundSource) {
            revert UnauthorizedNativeRefund(msg.sender, _nativeRefundSource);
        }
    }

    function _launchAndBuyNative(
        address creator,
        CreateMarketParams calldata params,
        uint256 firstBuyAmount,
        uint256 minTokensOut,
        address recipient
    ) internal returns (bytes32 marketId, address memeToken, uint256 tokensOut, uint256 refund) {
        _requireLaunchInput(creator, firstBuyAmount, recipient);
        _requireFactoryBinding();
        _requireNativeQuote(params.quoteAssetConfigId);

        uint256 fee = _launchFactory.launchFee();
        if (msg.value != fee + firstBuyAmount) {
            revert InvalidLaunchAndBuyValue(fee + firstBuyAmount, msg.value);
        }
        uint256 balanceBefore = address(this).balance - msg.value;

        address curve;
        (marketId, memeToken, curve,) = _launchFactory.createMarketFor{value: fee}(creator, params);
        _requireCreatedMarket(marketId, memeToken, curve);

        _nativeRefundSource = curve;
        uint256 quoteSpent;
        (tokensOut, quoteSpent) =
            IPonsCompatibleCurve(curve).buy{value: firstBuyAmount}(firstBuyAmount, minTokensOut, recipient);
        _nativeRefundSource = address(0);
        if (quoteSpent > firstBuyAmount) revert InvalidQuoteSpent(firstBuyAmount, quoteSpent);
        refund = firstBuyAmount - quoteSpent;

        uint256 expectedBalance = balanceBefore + refund;
        if (address(this).balance != expectedBalance) {
            revert NativeRefundBalanceMismatch(expectedBalance, address(this).balance);
        }
        if (refund != 0) {
            (bool success,) = payable(creator).call{value: refund}("");
            if (!success) revert NativeRefundTransferFailed(creator, refund);
        }
        if (address(this).balance != balanceBefore) {
            revert NativeRefundBalanceMismatch(balanceBefore, address(this).balance);
        }
    }

    function _requireLaunchInput(address creator, uint256 firstBuyAmount, address recipient) internal view {
        if (creator == address(0)) revert InvalidLaunchRouterDependency(creator);
        if (firstBuyAmount == 0) revert InvalidFirstBuyAmount(firstBuyAmount);
        if (recipient == address(0) || recipient == address(this)) revert InvalidFirstBuyRecipient(recipient);
    }

    function _requireFactoryBinding() internal view {
        if (address(_launchFactory).code.length == 0) {
            revert InvalidLaunchRouterDependency(address(_launchFactory));
        }
        address actual = address(ILaunchFactoryDependencies(address(_launchFactory)).approvedQuoteRegistry());
        if (actual != address(_approvedQuoteRegistry)) {
            revert LaunchFactoryRegistryMismatch(address(_approvedQuoteRegistry), actual);
        }
    }

    function _requireCreatedMarket(bytes32 marketId, address memeToken, address curve) internal view {
        if (marketId == bytes32(0) || memeToken.code.length == 0 || curve.code.length == 0) {
            revert InvalidCreatedMarket(marketId, memeToken, curve);
        }
    }

    function _requireNativeQuote(bytes32 quoteAssetConfigId) private view {
        QuoteAssetConfig memory quote = _approvedQuoteRegistry.quoteConfig(quoteAssetConfigId);
        if (quote.status != CONFIG_STATUS_ACTIVE) {
            revert QuoteConfigNotActive(quoteAssetConfigId, quote.status);
        }
        if (quote.quoteAsset != address(0)) {
            revert NativeQuoteRequired(quoteAssetConfigId, quote.quoteAsset);
        }
    }
}
