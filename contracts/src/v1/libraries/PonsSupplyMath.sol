// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/// @notice Full-precision supply partitioning and balance-independent tracked reserve accounting.
library PonsSupplyMath {
    struct TrackedReserves {
        uint256 trackedQuote;
        uint256 trackedTokens;
        uint256 accruedQuoteFees;
        uint256 reservedTokens;
    }

    error InvalidSupplyPartition(uint256 supply, uint256 phantomQuote, uint256 graduationThreshold);
    error InvalidGraduationPartition(uint256 sweptTokens, uint256 sweptQuote, uint256 phantomQuote);
    error TrackedTokensBelowReserve(uint256 trackedTokens, uint256 reservedTokens);
    error AccruedFeesExceedTrackedQuote(uint256 trackedQuote, uint256 accruedQuoteFees);
    error PricingQuoteReserveOverflow(uint256 phantomQuote, uint256 netTrackedQuote);

    function initialize(uint256 supply, uint256 phantomQuote, uint256 graduationThreshold)
        internal
        pure
        returns (TrackedReserves memory state)
    {
        (state.reservedTokens,) = supplyPartition(supply, phantomQuote, graduationThreshold);
        state.trackedTokens = supply;
    }

    function supplyPartition(uint256 supply, uint256 phantomQuote, uint256 graduationThreshold)
        internal
        pure
        returns (uint256 reservedTokens, uint256 initialSellableTokens)
    {
        if (
            supply == 0 || phantomQuote == 0 || graduationThreshold == 0
                || phantomQuote > type(uint256).max - graduationThreshold
        ) revert InvalidSupplyPartition(supply, phantomQuote, graduationThreshold);

        reservedTokens = Math.mulDiv(supply, phantomQuote, phantomQuote + graduationThreshold);
        if (reservedTokens == 0 || reservedTokens >= supply) {
            revert InvalidSupplyPartition(supply, phantomQuote, graduationThreshold);
        }
        initialSellableTokens = supply - reservedTokens;
    }

    /// @notice Smallest real Quote reserve that preserves the initial constant-product invariant at graduation.
    /// @dev Unlike amountIn(), this uses mathematical ceiling rather than an unconditional `floor + 1`. The
    ///      distinction matters when the division is exact: an ordinary buy can sell the complete curve inventory
    ///      with exactly this amount, so requiring one additional unit would make that valid terminal trade revert.
    function canonicalGraduationQuote(uint256 supply, uint256 phantomQuote, uint256 graduationThreshold)
        internal
        pure
        returns (uint256)
    {
        (uint256 reservedTokens, uint256 initialSellableTokens) =
            supplyPartition(supply, phantomQuote, graduationThreshold);
        return Math.mulDiv(initialSellableTokens, phantomQuote, reservedTokens, Math.Rounding.Ceil);
    }

    function graduationPartition(uint256 sweptTokens, uint256 sweptQuote, uint256 phantomQuote)
        internal
        pure
        returns (uint256 poolMemeAmount, uint256 lockedExcessMeme)
    {
        if (sweptTokens == 0 || sweptQuote == 0 || phantomQuote == 0 || sweptQuote > type(uint256).max - phantomQuote) {
            revert InvalidGraduationPartition(sweptTokens, sweptQuote, phantomQuote);
        }

        poolMemeAmount = Math.mulDiv(sweptTokens, sweptQuote, sweptQuote + phantomQuote);
        if (poolMemeAmount == 0 || poolMemeAmount > sweptTokens) {
            revert InvalidGraduationPartition(sweptTokens, sweptQuote, phantomQuote);
        }
        lockedExcessMeme = sweptTokens - poolMemeAmount;
    }

    function sellableTokens(TrackedReserves memory state) internal pure returns (uint256) {
        if (state.trackedTokens < state.reservedTokens) {
            revert TrackedTokensBelowReserve(state.trackedTokens, state.reservedTokens);
        }
        return state.trackedTokens - state.reservedTokens;
    }

    function pricingReserves(TrackedReserves memory state, uint256 phantomQuote)
        internal
        pure
        returns (uint256 pricingQuoteReserve, uint256 pricingTokenReserve)
    {
        if (state.accruedQuoteFees > state.trackedQuote) {
            revert AccruedFeesExceedTrackedQuote(state.trackedQuote, state.accruedQuoteFees);
        }
        uint256 netTrackedQuote = state.trackedQuote - state.accruedQuoteFees;
        if (phantomQuote > type(uint256).max - netTrackedQuote) {
            revert PricingQuoteReserveOverflow(phantomQuote, netTrackedQuote);
        }
        pricingQuoteReserve = phantomQuote + netTrackedQuote;
        pricingTokenReserve = state.trackedTokens;
    }
}
