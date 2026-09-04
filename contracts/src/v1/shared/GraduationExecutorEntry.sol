// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {IMarketRegistryV1, MarketView} from "../interfaces/IV1Protocol.sol";

/// @notice Authenticated automatic-graduation entry shared by the final GraduationExecutor.
abstract contract GraduationExecutorEntry is ReentrancyGuard {
    uint8 internal constant GRADUATION_PHASE_NOT_GRADUATED = 0;
    uint8 internal constant GRADUATION_PHASE_POOL_CREATED = 1;

    IMarketRegistryV1 internal immutable _graduationMarketRegistry;

    error InvalidGraduationRegistry(address registry);
    error UnauthorizedGraduationCurve(address caller, address expectedCurve);
    error GraduationNotReady(bytes32 marketId, uint8 launchPhase);
    error GraduationNotCommitted(bytes32 marketId, uint8 launchPhase, bytes32 poolId, uint32 sourceVersion);

    constructor(address marketRegistry_) {
        if (marketRegistry_.code.length == 0) revert InvalidGraduationRegistry(marketRegistry_);
        _graduationMarketRegistry = IMarketRegistryV1(marketRegistry_);
    }

    function graduateFromCurve(bytes32 marketId, uint256 quoteAmount, uint256 memeAmount)
        external
        payable
        virtual
        nonReentrant
    {
        MarketView memory marketView = _graduationMarketRegistry.market(marketId);
        if (msg.sender != marketView.config.curve) {
            revert UnauthorizedGraduationCurve(msg.sender, marketView.config.curve);
        }
        _executeAtomicGraduation(marketId, marketView, quoteAmount, memeAmount);
    }

    function _executeAtomicGraduation(
        bytes32 marketId,
        MarketView memory marketView,
        uint256 quoteAmount,
        uint256 memeAmount
    ) internal {
        if (marketView.runtime.launchPhase != GRADUATION_PHASE_NOT_GRADUATED || marketView.runtime.poolId != bytes32(0))
        {
            revert GraduationNotReady(marketId, marketView.runtime.launchPhase);
        }

        _graduateMarket(marketId, marketView, quoteAmount, memeAmount);

        MarketView memory committedMarket = _graduationMarketRegistry.market(marketId);
        uint32 expectedSourceVersion = marketView.runtime.sourceVersion + 1;
        if (
            committedMarket.config.curve != marketView.config.curve
                || committedMarket.runtime.launchPhase != GRADUATION_PHASE_POOL_CREATED
                || committedMarket.runtime.poolId == bytes32(0)
                || committedMarket.runtime.sourceVersion != expectedSourceVersion
        ) {
            revert GraduationNotCommitted(
                marketId,
                committedMarket.runtime.launchPhase,
                committedMarket.runtime.poolId,
                committedMarket.runtime.sourceVersion
            );
        }
    }

    function _graduateMarket(bytes32 marketId, MarketView memory marketView, uint256 quoteAmount, uint256 memeAmount)
        internal
        virtual;
}
