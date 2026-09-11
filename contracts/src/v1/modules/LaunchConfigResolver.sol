// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {
    IApprovedQuoteRegistry,
    ILaunchConfigResolver,
    ILaunchTemplateRegistry,
    ITickerGardenBaselineRegistry,
    LaunchTemplate,
    TickerGardenBaseline,
    QuoteAssetConfig
} from "../interfaces/IV1Protocol.sol";

/// @notice Read-only typed facade over the three launch-configuration registries.
/// @dev This contract does not copy or cache registry records. The immutable addresses are the
///      only local state; every resolve call forwards directly to the corresponding registry.
contract LaunchConfigResolver is ILaunchConfigResolver {
    address public immutable override approvedQuoteRegistry;
    address public immutable override tickerGardenBaselineRegistry;
    address public immutable override launchTemplateRegistry;

    error InvalidRegistry(address registry);
    error AliasedRegistries(address first, address second);

    constructor(
        address approvedQuoteRegistry_,
        address tickerGardenBaselineRegistry_,
        address launchTemplateRegistry_
    ) {
        _requireRegistry(approvedQuoteRegistry_);
        _requireRegistry(tickerGardenBaselineRegistry_);
        _requireRegistry(launchTemplateRegistry_);
        _requireDistinct(approvedQuoteRegistry_, tickerGardenBaselineRegistry_);
        _requireDistinct(approvedQuoteRegistry_, launchTemplateRegistry_);
        _requireDistinct(tickerGardenBaselineRegistry_, launchTemplateRegistry_);

        approvedQuoteRegistry = approvedQuoteRegistry_;
        tickerGardenBaselineRegistry = tickerGardenBaselineRegistry_;
        launchTemplateRegistry = launchTemplateRegistry_;
    }

    /// @notice Resolve one quote, baseline, and launch template snapshot in one typed read.
    /// @dev Registry storage remains authoritative and is read independently for each supplied ID.
    function resolve(bytes32 quoteAssetConfigId, bytes32 tickerGardenBaselineId, bytes32 launchTemplateId)
        external
        view
        override
        returns (QuoteAssetConfig memory quote, TickerGardenBaseline memory baseline, LaunchTemplate memory template)
    {
        quote = IApprovedQuoteRegistry(approvedQuoteRegistry).quoteConfig(quoteAssetConfigId);
        baseline = ITickerGardenBaselineRegistry(tickerGardenBaselineRegistry).baseline(tickerGardenBaselineId);
        template = ILaunchTemplateRegistry(launchTemplateRegistry).launchTemplate(launchTemplateId);
    }

    function _requireRegistry(address registry) private view {
        if (registry == address(0) || registry.code.length == 0) revert InvalidRegistry(registry);
    }

    function _requireDistinct(address first, address second) private pure {
        if (first == second) revert AliasedRegistries(first, second);
    }
}
