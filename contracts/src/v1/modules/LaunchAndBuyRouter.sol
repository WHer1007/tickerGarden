// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {CreateMarketParams, QuoteAssetConfig} from "../interfaces/IV1Protocol.sol";
import {LaunchAndBuyRouterERC20} from "../shared/LaunchAndBuyRouterERC20.sol";

/// @notice Canonical atomic market creation and first-buy router for native and ERC-20 Quote assets.
contract LaunchAndBuyRouter is LaunchAndBuyRouterERC20 {
    constructor(address predictedFactory, address approvedQuoteRegistry_)
        LaunchAndBuyRouterERC20(predictedFactory, approvedQuoteRegistry_)
    {}

    function launchAndBuy(
        CreateMarketParams calldata params,
        uint256 firstBuyAmount,
        uint256 minTokensOut,
        address recipient
    ) external payable nonReentrant returns (bytes32, address, uint256, uint256) {
        QuoteAssetConfig memory quoteConfig = _approvedQuoteRegistry.quoteConfig(params.quoteAssetConfigId);
        if (quoteConfig.quoteAsset == address(0)) {
            return _launchAndBuyNative(msg.sender, params, firstBuyAmount, minTokensOut, recipient, quoteConfig);
        }
        return _launchAndBuyERC20(msg.sender, params, firstBuyAmount, minTokensOut, recipient, quoteConfig);
    }

    function factory() external view returns (address) {
        return address(_launchFactory);
    }

    function approvedQuoteRegistry() external view returns (address) {
        return address(_approvedQuoteRegistry);
    }
}
