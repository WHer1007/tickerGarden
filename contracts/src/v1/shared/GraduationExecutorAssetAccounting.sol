// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {IApprovedQuoteRegistry, MarketView, QuoteAssetConfig} from "../interfaces/IV1Protocol.sol";
import {PonsSupplyMath} from "../libraries/PonsSupplyMath.sol";
import {GraduationExecutorEntry} from "./GraduationExecutorEntry.sol";

interface IGraduationRegistryDependencies {
    function approvedQuoteRegistry() external view returns (address);
}

/// @notice Formula and exact-balance accounting shared by the final GraduationExecutor.
/// @dev A concrete executor supplies the already-recorded per-market escrow amounts and consumes them by creating
///      the canonical pool and permanent Locker. Unrelated balances are deliberately excluded from the plan.
abstract contract GraduationExecutorAssetAccounting is GraduationExecutorEntry {
    struct GraduationAssetPlan {
        address quoteAsset;
        address memeToken;
        uint256 sweptQuote;
        uint256 sweptTokens;
        uint256 poolMemeAmount;
        uint256 lockedExcessMeme;
    }

    IApprovedQuoteRegistry internal immutable _graduationQuoteRegistry;

    error InvalidGraduationQuoteRegistry(address registry);
    error GraduationQuoteRegistryMismatch(address supplied, address expected);
    error GraduationMarketAssetMismatch(bytes32 marketId);
    error InsufficientGraduationEscrow(address asset, uint256 required, uint256 available);
    error GraduationAssetConsumptionMismatch(address asset, uint256 expected, uint256 actual);
    error InvalidLaunchLocker(address launchLocker);

    event PoolGraduated(
        bytes32 indexed marketId,
        bytes32 indexed poolId,
        address indexed launchLocker,
        uint256 sweptQuote,
        uint256 sweptTokens,
        uint256 poolMemeAmount,
        uint256 lockedExcessMeme,
        uint32 sourceVersion
    );

    constructor(address marketRegistry_, address quoteRegistry_) GraduationExecutorEntry(marketRegistry_) {
        if (quoteRegistry_.code.length == 0) revert InvalidGraduationQuoteRegistry(quoteRegistry_);
        address expectedQuoteRegistry = IGraduationRegistryDependencies(marketRegistry_).approvedQuoteRegistry();
        if (quoteRegistry_ != expectedQuoteRegistry) {
            revert GraduationQuoteRegistryMismatch(quoteRegistry_, expectedQuoteRegistry);
        }
        _graduationQuoteRegistry = IApprovedQuoteRegistry(quoteRegistry_);
    }

    receive() external payable {}

    function _graduateSweptMarket(bytes32 marketId, MarketView memory sweptMarket) internal override {
        GraduationAssetPlan memory plan = _graduationAssetPlan(marketId, sweptMarket);
        uint256 quoteBalanceBefore = _graduationAssetBalance(plan.quoteAsset);
        uint256 memeBalanceBefore = _graduationAssetBalance(plan.memeToken);
        _requireEscrowBalance(plan.quoteAsset, plan.sweptQuote, quoteBalanceBefore);
        _requireEscrowBalance(plan.memeToken, plan.sweptTokens, memeBalanceBefore);

        address launchLocker = _executeGraduationAssetPlan(marketId, sweptMarket, plan);
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
            plan.poolMemeAmount,
            plan.lockedExcessMeme,
            committedMarket.runtime.sourceVersion
        );
    }

    function _graduationAssetPlan(bytes32 marketId, MarketView memory sweptMarket)
        internal
        view
        returns (GraduationAssetPlan memory plan)
    {
        QuoteAssetConfig memory quote = _graduationQuoteRegistry.quoteConfig(sweptMarket.config.quoteAssetConfigId);
        if (
            sweptMarket.config.memeToken.code.length == 0
                || sweptMarket.config.memeToken == sweptMarket.config.quoteAsset
                || quote.quoteAsset != sweptMarket.config.quoteAsset
                || quote.ponsBaselineId != sweptMarket.config.ponsBaselineId
                || quote.economicsHash != sweptMarket.config.quoteAssetConfigId || quote.phantomQuote == 0
        ) revert GraduationMarketAssetMismatch(marketId);

        (plan.sweptQuote, plan.sweptTokens) = _recordedGraduationEscrow(marketId, sweptMarket);
        (plan.poolMemeAmount, plan.lockedExcessMeme) =
            PonsSupplyMath.graduationPartition(plan.sweptTokens, plan.sweptQuote, quote.phantomQuote);
        plan.quoteAsset = sweptMarket.config.quoteAsset;
        plan.memeToken = sweptMarket.config.memeToken;
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

    /// @dev C303-D reads the immutable record frozen by the exact per-market Curve in the outer sweep transaction, so
    ///      retries and rescue never infer amounts from this contract's aggregate balance.
    function _recordedGraduationEscrow(bytes32 marketId, MarketView memory sweptMarket)
        internal
        view
        virtual
        returns (uint256 sweptQuote, uint256 sweptTokens);

    /// @dev C303-C consumes poolMemeAmount and lockedExcessMeme through the canonical pool and permanent Locker.
    function _executeGraduationAssetPlan(
        bytes32 marketId,
        MarketView memory sweptMarket,
        GraduationAssetPlan memory plan
    ) internal virtual returns (address launchLocker);
}
