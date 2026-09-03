// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {IMarketRegistryV2, MarketView} from "../interfaces/IV2Protocol.sol";

/// @notice Authenticated automatic-graduation entry shared by the final GraduationExecutor.
abstract contract GraduationExecutorEntry is ReentrancyGuard {
    uint8 internal constant GRADUATION_PHASE_SWEPT = 1;
    uint8 internal constant GRADUATION_PHASE_POOL_CREATED = 2;
    uint8 internal constant GRADUATION_MARKET_ACTIVE = 0;

    IMarketRegistryV2 internal immutable _graduationMarketRegistry;

    error InvalidGraduationRegistry(address registry);
    error UnauthorizedGraduationCurve(address caller, address expectedCurve);
    error GraduationNotRetryable(bytes32 marketId, uint8 launchPhase, uint8 marketStatus);
    error GraduationNotCommitted(
        bytes32 marketId, uint8 launchPhase, uint8 marketStatus, bytes32 poolId, uint32 sourceVersion, uint64 sweptAt
    );

    constructor(address marketRegistry_) {
        if (marketRegistry_.code.length == 0) revert InvalidGraduationRegistry(marketRegistry_);
        _graduationMarketRegistry = IMarketRegistryV2(marketRegistry_);
    }

    function graduateFromCurve(bytes32 marketId) external virtual nonReentrant {
        MarketView memory sweptMarket = _graduationMarketRegistry.market(marketId);
        if (msg.sender != sweptMarket.config.curve) {
            revert UnauthorizedGraduationCurve(msg.sender, sweptMarket.config.curve);
        }
        _executeSweptGraduation(marketId, sweptMarket);
    }

    function _executeSweptGraduation(bytes32 marketId, MarketView memory sweptMarket) internal {
        if (
            sweptMarket.runtime.launchPhase != GRADUATION_PHASE_SWEPT
                || sweptMarket.runtime.marketStatus != GRADUATION_MARKET_ACTIVE
        ) {
            revert GraduationNotRetryable(marketId, sweptMarket.runtime.launchPhase, sweptMarket.runtime.marketStatus);
        }

        _graduateSweptMarket(marketId, sweptMarket);

        MarketView memory committedMarket = _graduationMarketRegistry.market(marketId);
        uint32 expectedSourceVersion = sweptMarket.runtime.sourceVersion + 1;
        if (
            committedMarket.config.curve != sweptMarket.config.curve
                || committedMarket.runtime.launchPhase != GRADUATION_PHASE_POOL_CREATED
                || committedMarket.runtime.marketStatus != GRADUATION_MARKET_ACTIVE
                || committedMarket.runtime.poolId == bytes32(0)
                || committedMarket.runtime.sourceVersion != expectedSourceVersion
                || committedMarket.runtime.sweptAt != sweptMarket.runtime.sweptAt
        ) {
            revert GraduationNotCommitted(
                marketId,
                committedMarket.runtime.launchPhase,
                committedMarket.runtime.marketStatus,
                committedMarket.runtime.poolId,
                committedMarket.runtime.sourceVersion,
                committedMarket.runtime.sweptAt
            );
        }
    }

    function _graduateSweptMarket(bytes32 marketId, MarketView memory sweptMarket) internal virtual;
}
