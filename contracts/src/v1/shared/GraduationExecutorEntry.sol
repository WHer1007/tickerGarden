// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {IMarketRegistryV1, MarketView} from "../interfaces/IV1Protocol.sol";

/// @notice Authenticated automatic-graduation entry shared by the final GraduationExecutor.
abstract contract GraduationExecutorEntry is ReentrancyGuard {
    uint8 internal constant GRADUATION_PHASE_SWEPT = 1;
    uint8 internal constant GRADUATION_PHASE_POOL_CREATED = 2;

    IMarketRegistryV1 internal immutable _graduationMarketRegistry;

    error InvalidGraduationRegistry(address registry);
    error UnauthorizedGraduationCurve(address caller, address expectedCurve);
    error GraduationNotRetryable(bytes32 marketId, uint8 launchPhase);
    error GraduationNotCommitted(
        bytes32 marketId, uint8 launchPhase, bytes32 poolId, uint32 sourceVersion, uint64 sweptAt
    );

    constructor(address marketRegistry_) {
        if (marketRegistry_.code.length == 0) revert InvalidGraduationRegistry(marketRegistry_);
        _graduationMarketRegistry = IMarketRegistryV1(marketRegistry_);
    }

    function graduateFromCurve(bytes32 marketId) external virtual nonReentrant {
        MarketView memory sweptMarket = _graduationMarketRegistry.market(marketId);
        if (msg.sender != sweptMarket.config.curve) {
            revert UnauthorizedGraduationCurve(msg.sender, sweptMarket.config.curve);
        }
        _executeSweptGraduation(marketId, sweptMarket);
    }

    function _executeSweptGraduation(bytes32 marketId, MarketView memory sweptMarket) internal {
        if (sweptMarket.runtime.launchPhase != GRADUATION_PHASE_SWEPT) {
            revert GraduationNotRetryable(marketId, sweptMarket.runtime.launchPhase);
        }

        _graduateSweptMarket(marketId, sweptMarket);

        MarketView memory committedMarket = _graduationMarketRegistry.market(marketId);
        uint32 expectedSourceVersion = sweptMarket.runtime.sourceVersion + 1;
        if (
            committedMarket.config.curve != sweptMarket.config.curve
                || committedMarket.runtime.launchPhase != GRADUATION_PHASE_POOL_CREATED
                || committedMarket.runtime.poolId == bytes32(0)
                || committedMarket.runtime.sourceVersion != expectedSourceVersion
                || committedMarket.runtime.sweptAt != sweptMarket.runtime.sweptAt
        ) {
            revert GraduationNotCommitted(
                marketId,
                committedMarket.runtime.launchPhase,
                committedMarket.runtime.poolId,
                committedMarket.runtime.sourceVersion,
                committedMarket.runtime.sweptAt
            );
        }
    }

    function _graduateSweptMarket(bytes32 marketId, MarketView memory sweptMarket) internal virtual;
}
