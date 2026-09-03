// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {MarketView} from "../interfaces/IV2Protocol.sol";
import {GraduationExecutorPoolExecution} from "./GraduationExecutorPoolExecution.sol";

interface ICurveGraduationEscrow {
    function graduationEscrow() external view returns (uint256 sweptQuote, uint256 sweptTokens);
}

/// @notice Persistent Curve escrow evidence, permissionless retry, and delayed fixed-path rescue for GraduationExecutor.
/// @dev The canonical mutation surface remains closed: the exact per-market Curve freezes its transferred amounts in
///      the outer sweep transaction, and this layer only reads that immutable evidence. A caught automatic-graduation
///      revert therefore cannot erase the record needed by a later retry or rescue.
abstract contract GraduationExecutorRetryAndRescue is GraduationExecutorPoolExecution {
    using SafeERC20 for IERC20;

    uint8 private constant LAUNCH_PHASE_SWEPT = 1;
    uint8 private constant LAUNCH_PHASE_RESCUED = 3;
    uint256 private constant RESCUE_DELAY = 7 days;

    address internal immutable _graduationRescueRecipient;

    error InvalidGraduationRescueRecipient(address recipient);
    error InvalidRecordedGraduationEscrow(bytes32 marketId, uint256 sweptQuote, uint256 sweptTokens);
    error GraduationRescueNotReady(uint256 readyAt);
    error GraduationRescueTimestampOverflow(uint256 timestamp);
    error GraduationRescueTransferFailed(address asset, address recipient, uint256 amount);
    error GraduationRescueNotCommitted(bytes32 marketId, uint8 launchPhase, uint64 sweptAt);

    event LaunchRescued(bytes32 indexed marketId, uint64 sweptAt, uint64 rescuedAt);

    constructor(
        address marketRegistry_,
        address quoteRegistry_,
        address poolManager_,
        address positionManager_,
        address hook_,
        address quoteDustRecipient_,
        address rescueRecipient_
    )
        GraduationExecutorPoolExecution(
            marketRegistry_, quoteRegistry_, poolManager_, positionManager_, hook_, quoteDustRecipient_
        )
    {
        if (
            rescueRecipient_ == address(0) || rescueRecipient_ == address(this) || rescueRecipient_ == poolManager_
                || rescueRecipient_ == positionManager_ || rescueRecipient_ == hook_
                || rescueRecipient_ == address(_graduationPermit2)
                || rescueRecipient_ == address(_graduationMarketRegistry)
                || rescueRecipient_ == address(_graduationQuoteRegistry) || rescueRecipient_ == _graduationFactory
        ) revert InvalidGraduationRescueRecipient(rescueRecipient_);
        _graduationRescueRecipient = rescueRecipient_;
    }

    /// @notice Permissionlessly retries the same atomic pool-creation algorithm used by automatic graduation.
    function retryGraduation(bytes32 marketId) external nonReentrant {
        _executeSweptGraduation(marketId, _graduationMarketRegistry.market(marketId));
    }

    /// @notice Sends an ungraduated market's exact escrow to the deployment-frozen distribution path after seven days.
    function rescueSweptLaunch(bytes32 marketId) external nonReentrant {
        MarketView memory sweptMarket = _graduationMarketRegistry.market(marketId);
        if (sweptMarket.runtime.launchPhase != LAUNCH_PHASE_SWEPT || sweptMarket.runtime.sweptAt == 0) {
            revert GraduationNotRetryable(marketId, sweptMarket.runtime.launchPhase, sweptMarket.runtime.marketStatus);
        }

        uint256 readyAt = uint256(sweptMarket.runtime.sweptAt) + RESCUE_DELAY;
        if (block.timestamp < readyAt) revert GraduationRescueNotReady(readyAt);
        if (block.timestamp > type(uint64).max) revert GraduationRescueTimestampOverflow(block.timestamp);

        (uint256 sweptQuote, uint256 sweptTokens) = _recordedGraduationEscrow(marketId, sweptMarket);
        _requireRescueBalance(sweptMarket.config.quoteAsset, sweptQuote);
        _requireRescueBalance(sweptMarket.config.memeToken, sweptTokens);

        _transferRescueAsset(sweptMarket.config.quoteAsset, sweptQuote);
        _transferRescueAsset(sweptMarket.config.memeToken, sweptTokens);
        _graduationMarketRegistry.markRescued(marketId);

        MarketView memory rescuedMarket = _graduationMarketRegistry.market(marketId);
        if (
            rescuedMarket.runtime.launchPhase != LAUNCH_PHASE_RESCUED
                || rescuedMarket.runtime.sweptAt != sweptMarket.runtime.sweptAt
                || rescuedMarket.runtime.poolId != bytes32(0)
                || rescuedMarket.runtime.sourceVersion != sweptMarket.runtime.sourceVersion
        ) {
            revert GraduationRescueNotCommitted(
                marketId, rescuedMarket.runtime.launchPhase, rescuedMarket.runtime.sweptAt
            );
        }
        emit LaunchRescued(marketId, sweptMarket.runtime.sweptAt, uint64(block.timestamp));
    }

    function _recordedGraduationEscrow(bytes32 marketId, MarketView memory sweptMarket)
        internal
        view
        override
        returns (uint256 sweptQuote, uint256 sweptTokens)
    {
        try ICurveGraduationEscrow(sweptMarket.config.curve).graduationEscrow() returns (
            uint256 quoteAmount, uint256 tokenAmount
        ) {
            sweptQuote = quoteAmount;
            sweptTokens = tokenAmount;
        } catch {
            revert InvalidRecordedGraduationEscrow(marketId, 0, 0);
        }
        if (sweptQuote == 0 || sweptTokens == 0) {
            revert InvalidRecordedGraduationEscrow(marketId, sweptQuote, sweptTokens);
        }
    }

    function _requireRescueBalance(address asset, uint256 required) private view {
        uint256 available = asset == address(0) ? address(this).balance : IERC20(asset).balanceOf(address(this));
        if (available < required) revert InsufficientGraduationEscrow(asset, required, available);
    }

    function _transferRescueAsset(address asset, uint256 amount) private {
        uint256 executorBefore = asset == address(0) ? address(this).balance : IERC20(asset).balanceOf(address(this));
        uint256 recipientBefore = asset == address(0)
            ? _graduationRescueRecipient.balance
            : IERC20(asset).balanceOf(_graduationRescueRecipient);
        if (asset == address(0)) {
            (bool success,) = payable(_graduationRescueRecipient).call{value: amount}("");
            if (!success) {
                revert GraduationRescueTransferFailed(asset, _graduationRescueRecipient, amount);
            }
        } else {
            IERC20(asset).safeTransfer(_graduationRescueRecipient, amount);
        }
        uint256 executorAfter = asset == address(0) ? address(this).balance : IERC20(asset).balanceOf(address(this));
        uint256 recipientAfter = asset == address(0)
            ? _graduationRescueRecipient.balance
            : IERC20(asset).balanceOf(_graduationRescueRecipient);
        if (
            executorBefore < executorAfter || executorBefore - executorAfter != amount
                || recipientAfter < recipientBefore || recipientAfter - recipientBefore != amount
        ) revert GraduationRescueTransferFailed(asset, _graduationRescueRecipient, amount);
    }
}
