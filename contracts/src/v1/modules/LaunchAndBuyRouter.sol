// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {CreateMarketParams, QuoteAssetConfig} from "../interfaces/IV1Protocol.sol";
import {LaunchAndBuyRouterV4Fallback} from "../shared/LaunchAndBuyRouterV4Fallback.sol";

/// @notice Canonical atomic market creation and first-buy router for native and ERC-20 Quote assets.
contract LaunchAndBuyRouter is LaunchAndBuyRouterV4Fallback {
    constructor(
        address predictedFactory,
        address approvedQuoteRegistry_,
        address poolManager_,
        uint24 nativeQuotePoolFee_,
        int24 nativeQuoteTickSpacing_
    )
        LaunchAndBuyRouterV4Fallback(
            predictedFactory,
            approvedQuoteRegistry_,
            poolManager_,
            nativeQuotePoolFee_,
            nativeQuoteTickSpacing_
        )
    {}

    function launchAndBuy(
        CreateMarketParams calldata params,
        uint256 firstBuyAmount,
        uint256 minTokensOut,
        address recipient
    ) external payable nonReentrant returns (bytes32, address, uint256, uint256) {
        QuoteAssetConfig memory quoteConfig = _approvedQuoteRegistry.quoteConfig(params.quoteAssetConfigId);
        if (quoteConfig.quoteAsset == address(0)) {
            return _launchAndBuyNative(msg.sender, params, firstBuyAmount, minTokensOut, recipient);
        }
        uint256 fee = _launchFactory.launchFee();
        if (msg.value > fee) {
            return _launchAndBuyERC20FromNative(msg.sender, params, firstBuyAmount, minTokensOut, recipient);
        }
        return _launchAndBuyERC20(msg.sender, params, firstBuyAmount, minTokensOut, recipient);
    }

    function factory() external view returns (address) {
        return address(_launchFactory);
    }

    function approvedQuoteRegistry() external view returns (address) {
        return address(_approvedQuoteRegistry);
    }
}
