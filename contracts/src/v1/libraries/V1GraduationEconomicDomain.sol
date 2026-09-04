// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {PonsBaseline, PoolKey, QuoteAssetConfig} from "../interfaces/IV1Protocol.sol";
import {GraduationPoolMath} from "./GraduationPoolMath.sol";
import {PonsCurveMath} from "./PonsCurveMath.sol";
import {PonsSupplyMath} from "./PonsSupplyMath.sol";

/// @notice Admission-time proof that a paired Pons/Quote configuration has a representable graduation plan.
/// @dev The terminal Quote bound includes both independently rounded fee legs. Both token address orderings are
///      checked because the CREATE2 meme address is not known when a Quote or Pons baseline is registered.
library V1GraduationEconomicDomain {
    uint256 internal constant MAX_V4_SIGNED_AMOUNT = uint256(uint128(type(int128).max));
    uint256 private constant MAX_TERMINAL_FEE_ROUNDING = 2;
    address private constant SYNTHETIC_TOKEN_0 = address(1);
    address private constant SYNTHETIC_TOKEN_1 = address(2);
    address private constant CANONICAL_HOOK = address(0x2044);

    error EconomicValueOutsideGraduationDomain(uint256 supply, uint256 phantomQuote, uint256 graduationThreshold);
    error TerminalQuoteOutsideGraduationDomain(uint256 terminalQuote, uint256 maximum);

    function validate(PonsBaseline memory baseline, QuoteAssetConfig memory quote) internal pure {
        if (
            baseline.supply == 0 || baseline.supply > MAX_V4_SIGNED_AMOUNT || quote.phantomQuote == 0
                || quote.phantomQuote > MAX_V4_SIGNED_AMOUNT || quote.graduationThreshold == 0
                || quote.graduationThreshold > MAX_V4_SIGNED_AMOUNT
        ) {
            revert EconomicValueOutsideGraduationDomain(baseline.supply, quote.phantomQuote, quote.graduationThreshold);
        }

        (uint256 sweptTokens, uint256 sellableTokens) =
            PonsSupplyMath.supplyPartition(baseline.supply, quote.phantomQuote, quote.graduationThreshold);
        uint256 minimumTerminalQuote = PonsCurveMath.amountIn(sellableTokens, quote.phantomQuote, baseline.supply, 0);
        if (minimumTerminalQuote > MAX_V4_SIGNED_AMOUNT - MAX_TERMINAL_FEE_ROUNDING) {
            revert TerminalQuoteOutsideGraduationDomain(minimumTerminalQuote, MAX_V4_SIGNED_AMOUNT);
        }
        uint256 maximumTerminalQuote = minimumTerminalQuote + MAX_TERMINAL_FEE_ROUNDING;

        _validatePoolPlan(sweptTokens, minimumTerminalQuote, quote.phantomQuote, baseline.tickSpacing);
        if (maximumTerminalQuote != minimumTerminalQuote) {
            _validatePoolPlan(sweptTokens, maximumTerminalQuote, quote.phantomQuote, baseline.tickSpacing);
        }
    }

    function _validatePoolPlan(uint256 sweptTokens, uint256 sweptQuote, uint256 phantomQuote, int24 tickSpacing)
        private
        pure
    {
        (uint256 poolMemeAmount,) = PonsSupplyMath.graduationPartition(sweptTokens, sweptQuote, phantomQuote);
        PoolKey memory key = PoolKey({
            currency0: SYNTHETIC_TOKEN_0,
            currency1: SYNTHETIC_TOKEN_1,
            fee: 0,
            tickSpacing: tickSpacing,
            hooks: CANONICAL_HOOK
        });

        GraduationPoolMath.derive(key, SYNTHETIC_TOKEN_0, SYNTHETIC_TOKEN_1, sweptQuote, poolMemeAmount);
        GraduationPoolMath.derive(key, SYNTHETIC_TOKEN_1, SYNTHETIC_TOKEN_0, sweptQuote, poolMemeAmount);
    }
}
