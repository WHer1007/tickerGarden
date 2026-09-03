// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {PonsCurveMath} from "./PonsCurveMath.sol";

/// @notice Frozen three-second Pons runtime anti-snipe policy for buy quotes.
/// @dev The atomic first-buy recipient must be supplied only by an authenticated Router execution context.
library PonsAntiSnipe {
    uint256 internal constant BPS_DENOMINATOR = 10_000;
    uint256 internal constant MINIMUM_NET_BPS = 100;
    uint256 internal constant CREATOR_TAX_BPS = 0;
    uint256 internal constant SNIPE_TAX_SECONDS = 3;

    uint256 internal constant ELAPSED_0_RAW_BPS = 9_900;
    uint256 internal constant ELAPSED_1_RAW_BPS = 618;
    uint256 internal constant ELAPSED_2_RAW_BPS = 19;

    struct ExemptionContext {
        address creator;
        address beneficiaryAtCreation;
        address launchRouter;
        address atomicFirstBuyRecipient;
    }

    struct AntiSnipeBuyQuote {
        uint256 rawSnipeBps;
        uint256 effectiveSnipeBps;
        bool exempt;
        PonsCurveMath.BuyQuote curveQuote;
    }

    error InvalidRecipient(address recipient);
    error InvalidFrozenIdentity(address creator, address beneficiaryAtCreation);
    error InvalidLaunchRouter(address launchRouter);
    error TimestampBeforeLaunch(uint256 currentTimestamp, uint256 launchTimestamp);
    error FeeLeavesLessThanMinimumNet(uint256 feeBps, uint256 minimumNetBps);

    function elapsedSince(uint256 currentTimestamp, uint256 launchTimestamp) internal pure returns (uint256) {
        if (currentTimestamp < launchTimestamp) revert TimestampBeforeLaunch(currentTimestamp, launchTimestamp);
        return currentTimestamp - launchTimestamp;
    }

    function isExempt(address recipient, address caller, ExemptionContext memory context) internal pure returns (bool) {
        if (recipient == address(0)) revert InvalidRecipient(recipient);
        if (context.creator == address(0) || context.beneficiaryAtCreation == address(0)) {
            revert InvalidFrozenIdentity(context.creator, context.beneficiaryAtCreation);
        }
        if (context.launchRouter == address(0)) revert InvalidLaunchRouter(context.launchRouter);
        return recipient == context.creator || recipient == context.beneficiaryAtCreation
            || (caller == context.launchRouter
                && context.atomicFirstBuyRecipient != address(0)
                && recipient == context.atomicFirstBuyRecipient);
    }

    function rawSnipeBps(uint256 elapsedSeconds, bool exempt) internal pure returns (uint256) {
        if (exempt || elapsedSeconds >= SNIPE_TAX_SECONDS) return 0;
        if (elapsedSeconds == 0) return ELAPSED_0_RAW_BPS;
        if (elapsedSeconds == 1) return ELAPSED_1_RAW_BPS;
        return ELAPSED_2_RAW_BPS;
    }

    function effectiveSnipeBps(uint256 elapsedSeconds, bool exempt, uint256 feeBps)
        internal
        pure
        returns (uint256 rawBps, uint256 effectiveBps)
    {
        if (feeBps > BPS_DENOMINATOR - CREATOR_TAX_BPS - MINIMUM_NET_BPS) {
            revert FeeLeavesLessThanMinimumNet(feeBps, MINIMUM_NET_BPS);
        }

        rawBps = rawSnipeBps(elapsedSeconds, exempt);
        uint256 maximumSnipeBps = BPS_DENOMINATOR - feeBps - CREATOR_TAX_BPS - MINIMUM_NET_BPS;
        effectiveBps = rawBps < maximumSnipeBps ? rawBps : maximumSnipeBps;
    }

    function quoteBuy(
        uint256 quoteReceived,
        uint256 quoteReserve,
        uint256 tokenReserve,
        uint256 reservedTokens,
        uint256 feeBps,
        uint256 minTokensOut,
        uint256 currentTimestamp,
        uint256 launchTimestamp,
        address recipient,
        address caller,
        ExemptionContext memory context
    ) internal pure returns (AntiSnipeBuyQuote memory quote) {
        quote.exempt = isExempt(recipient, caller, context);
        uint256 elapsedSeconds = elapsedSince(currentTimestamp, launchTimestamp);
        (quote.rawSnipeBps, quote.effectiveSnipeBps) = effectiveSnipeBps(elapsedSeconds, quote.exempt, feeBps);
        quote.curveQuote = PonsCurveMath.quoteBuy(
            quoteReceived, quoteReserve, tokenReserve, reservedTokens, feeBps, quote.effectiveSnipeBps, minTokensOut
        );
    }
}
