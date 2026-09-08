// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {
    IApprovedQuoteRegistry,
    ITickerGardenBaselineRegistry,
    MarketView,
    TickerGardenBaseline,
    QuoteAssetConfig
} from "../interfaces/IV1Protocol.sol";
import {TickerGardenSupplyMath} from "../libraries/TickerGardenSupplyMath.sol";
import {GraduationExecutorEntry} from "./GraduationExecutorEntry.sol";

interface IGraduationRegistryDependencies {
    function approvedQuoteRegistry() external view returns (address);
    function tickerGardenBaselineRegistry() external view returns (address);
}

/// @notice Formula and exact-balance accounting shared by the final GraduationExecutor.
/// @dev The exact registered Curve supplies the terminal amounts in the same transaction that creates the canonical
///      pool and permanent Locker. Unrelated balances are deliberately excluded from the plan.
abstract contract GraduationExecutorAssetAccounting is GraduationExecutorEntry {
    struct GraduationAssetPlan {
        address quoteAsset;
        address memeToken;
        uint256 sweptQuote;
        uint256 sweptTokens;
        uint256 poolQuoteAmount;
        uint256 poolMemeAmount;
        uint256 lockedExcessQuote;
        uint256 lockedExcessMeme;
    }

    IApprovedQuoteRegistry internal immutable _graduationQuoteRegistry;
    ITickerGardenBaselineRegistry internal immutable _graduationTickerGardenBaselineRegistry;

    error InvalidGraduationQuoteRegistry(address registry);
    error GraduationQuoteRegistryMismatch(address supplied, address expected);
    error GraduationMarketAssetMismatch(bytes32 marketId);
    error InvalidGraduationPaymentValue(uint256 expected, uint256 actual);
    error InsufficientGraduationEscrow(address asset, uint256 required, uint256 available);
    error GraduationAssetConsumptionMismatch(address asset, uint256 expected, uint256 actual);
    error InvalidLaunchLocker(address launchLocker);

    event PoolGraduated(
        bytes32 indexed marketId,
        bytes32 indexed poolId,
        address indexed launchLocker,
        uint256 sweptQuote,
        uint256 sweptTokens,
        uint256 poolQuoteAmount,
        uint256 poolMemeAmount,
        uint256 lockedExcessQuote,
        uint256 lockedExcessMeme,
        uint32 sourceVersion
    );

    constructor(address marketRegistry_, address quoteRegistry_) GraduationExecutorEntry(marketRegistry_) {
        if (quoteRegistry_.code.length == 0) revert InvalidGraduationQuoteRegistry(quoteRegistry_);
        IGraduationRegistryDependencies dependencies = IGraduationRegistryDependencies(marketRegistry_);
        address expectedQuoteRegistry = dependencies.approvedQuoteRegistry();
        if (quoteRegistry_ != expectedQuoteRegistry) {
            revert GraduationQuoteRegistryMismatch(quoteRegistry_, expectedQuoteRegistry);
        }
        address tickerGardenBaselineRegistry_ = dependencies.tickerGardenBaselineRegistry();
        if (tickerGardenBaselineRegistry_.code.length == 0 || tickerGardenBaselineRegistry_ == quoteRegistry_) {
            revert InvalidGraduationQuoteRegistry(tickerGardenBaselineRegistry_);
        }
        _graduationQuoteRegistry = IApprovedQuoteRegistry(quoteRegistry_);
        _graduationTickerGardenBaselineRegistry = ITickerGardenBaselineRegistry(tickerGardenBaselineRegistry_);
    }

    receive() external payable {}

    function _graduateMarket(bytes32 marketId, MarketView memory marketView, uint256 quoteAmount, uint256 memeAmount)
        internal
        override
    {
        uint256 expectedValue = marketView.config.quoteAsset == address(0) ? quoteAmount : 0;
        if (msg.value != expectedValue) revert InvalidGraduationPaymentValue(expectedValue, msg.value);

        GraduationAssetPlan memory plan = _graduationAssetPlan(marketId, marketView, quoteAmount, memeAmount);
        uint256 quoteBalanceBefore = _graduationAssetBalance(plan.quoteAsset);
        uint256 memeBalanceBefore = _graduationAssetBalance(plan.memeToken);
        _requireEscrowBalance(plan.quoteAsset, plan.sweptQuote, quoteBalanceBefore);
        _requireEscrowBalance(plan.memeToken, plan.sweptTokens, memeBalanceBefore);

        address launchLocker = _executeGraduationAssetPlan(marketId, marketView, plan);
        if (launchLocker == address(0) || launchLocker == address(this)) revert InvalidLaunchLocker(launchLocker);

        _requireExactConsumption(plan.quoteAsset, plan.sweptQuote, quoteBalanceBefore);
        _requireExactConsumption(plan.memeToken, plan.sweptTokens, memeBalanceBefore);

        MarketView memory committedMarket = _graduationMarketRegistry.market(marketId);
        emit PoolGraduated(
            marketId,
            committedMarket.runtime.poolId,
            launchLocker,
            plan.sweptQuote,
            plan.sweptTokens,
            plan.poolQuoteAmount,
            plan.poolMemeAmount,
            plan.lockedExcessQuote,
            plan.lockedExcessMeme,
            committedMarket.runtime.sourceVersion
        );
    }

    function _graduationAssetPlan(
        bytes32 marketId,
        MarketView memory marketView,
        uint256 quoteAmount,
        uint256 memeAmount
    ) internal view returns (GraduationAssetPlan memory plan) {
        QuoteAssetConfig memory quote = _graduationQuoteRegistry.quoteConfig(marketView.config.quoteAssetConfigId);
        TickerGardenBaseline memory baseline = _graduationTickerGardenBaselineRegistry.baseline(marketView.config.tickerGardenBaselineId);
        if (
            quoteAmount == 0 || memeAmount == 0 || marketView.config.memeToken.code.length == 0
                || marketView.config.memeToken == marketView.config.quoteAsset
                || quote.quoteAsset != marketView.config.quoteAsset
                || quote.tickerGardenBaselineId != marketView.config.tickerGardenBaselineId
                || quote.economicsHash != marketView.config.quoteAssetConfigId || quote.phantomQuote == 0
                || baseline.supply == 0
        ) revert GraduationMarketAssetMismatch(marketId);

        plan.sweptQuote = quoteAmount;
        plan.sweptTokens = memeAmount;
        (uint256 reservedTokens,) =
            TickerGardenSupplyMath.supplyPartition(baseline.supply, quote.phantomQuote, quote.graduationThreshold);
        plan.poolQuoteAmount =
            TickerGardenSupplyMath.canonicalGraduationQuote(baseline.supply, quote.phantomQuote, quote.graduationThreshold);
        if (memeAmount != reservedTokens || quoteAmount < plan.poolQuoteAmount) {
            revert GraduationMarketAssetMismatch(marketId);
        }
        plan.lockedExcessQuote = quoteAmount - plan.poolQuoteAmount;
        (plan.poolMemeAmount, plan.lockedExcessMeme) =
            TickerGardenSupplyMath.graduationPartition(plan.sweptTokens, plan.poolQuoteAmount, quote.phantomQuote);
        plan.quoteAsset = marketView.config.quoteAsset;
        plan.memeToken = marketView.config.memeToken;
    }

    function _graduationAssetBalance(address asset) internal view returns (uint256 balance) {
        if (asset == address(0)) return address(this).balance;
        balance = IERC20(asset).balanceOf(address(this));
    }

    function _requireEscrowBalance(address asset, uint256 required, uint256 available) private pure {
        if (available < required) revert InsufficientGraduationEscrow(asset, required, available);
    }

    function _requireExactConsumption(address asset, uint256 expected, uint256 beforeBalance) private view {
        uint256 afterBalance = _graduationAssetBalance(asset);
        uint256 actual = beforeBalance >= afterBalance ? beforeBalance - afterBalance : type(uint256).max;
        if (actual != expected) revert GraduationAssetConsumptionMismatch(asset, expected, actual);
    }

    /// @dev C303-C consumes poolMemeAmount and lockedExcessMeme through the canonical pool and permanent Locker.
    function _executeGraduationAssetPlan(
        bytes32 marketId,
        MarketView memory sweptMarket,
        GraduationAssetPlan memory plan
    ) internal virtual returns (address launchLocker);
}
