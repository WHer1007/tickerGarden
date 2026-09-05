// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/// @notice Pure, full-precision Pons-compatible constant-product quote math.
/// @dev Fee legs are deliberately rounded independently. Callers must supply fee policy from trusted runtime state.
library PonsCurveMath {
    uint256 internal constant BPS_DENOMINATOR = 10_000;

    struct BuyQuote {
        uint256 creatorTaxFee;
        uint256 quoteReceived;
        uint256 quoteSpent;
        uint256 fee;
        uint256 additionalQuoteFee;
        uint256 netQuote;
        uint256 tokensOut;
        uint256 refund;
        uint256 netRequired;
        bool partialFill;
        bool slippagePass;
    }

    struct SellQuote {
        uint256 tokensIn;
        uint256 grossQuoteOut;
        uint256 fee;
        uint256 additionalQuoteFee;
        uint256 quoteOut;
        bool slippagePass;
    }

    error InvalidAmountIn(uint256 amountIn);
    error InvalidAmountOut(uint256 amountOut);
    error InvalidReserves(uint256 reserveIn, uint256 reserveOut);
    error InvalidFeeBps(uint256 feeBps);
    error InvalidCombinedFeeBps(uint256 feeBps, uint256 additionalQuoteFeeBps);
    error InsufficientSellableLiquidity(uint256 tokenReserve, uint256 reservedTokens);
    error AmountOutRoundsToZero();
    error ArithmeticOverflow();

    function amountOut(uint256 amountInValue, uint256 reserveIn, uint256 reserveOut, uint256 feeBps)
        internal
        pure
        returns (uint256 result)
    {
        if (amountInValue == 0) revert InvalidAmountIn(amountInValue);
        if (reserveIn == 0 || reserveOut == 0) revert InvalidReserves(reserveIn, reserveOut);
        if (feeBps >= BPS_DENOMINATOR) revert InvalidFeeBps(feeBps);

        uint256 amountInWithFee = _checkedMul(amountInValue, BPS_DENOMINATOR - feeBps);
        uint256 scaledReserveIn = _checkedMul(reserveIn, BPS_DENOMINATOR);
        uint256 denominator = _checkedAdd(scaledReserveIn, amountInWithFee);
        result = Math.mulDiv(amountInWithFee, reserveOut, denominator);
        if (result == 0) revert AmountOutRoundsToZero();
    }

    function amountIn(uint256 desiredAmountOut, uint256 reserveIn, uint256 reserveOut, uint256 feeBps)
        internal
        pure
        returns (uint256 result)
    {
        if (desiredAmountOut == 0) revert InvalidAmountOut(desiredAmountOut);
        if (reserveIn == 0 || reserveOut <= desiredAmountOut) revert InvalidReserves(reserveIn, reserveOut);
        if (feeBps >= BPS_DENOMINATOR) revert InvalidFeeBps(feeBps);

        uint256 scaledReserveIn = _checkedMul(reserveIn, BPS_DENOMINATOR);
        uint256 denominator = _checkedMul(reserveOut - desiredAmountOut, BPS_DENOMINATOR - feeBps);
        uint256 floored = Math.mulDiv(desiredAmountOut, scaledReserveIn, denominator);
        result = _checkedAdd(floored, 1);
    }

    function quoteBuy(
        uint256 quoteReceived,
        uint256 quoteReserve,
        uint256 tokenReserve,
        uint256 reservedTokens,
        uint256 feeBps,
        uint256 additionalQuoteFeeBps,
        uint256 minTokensOut
    ) internal pure returns (BuyQuote memory quote) {
        return quoteBuyWithCreatorTax(
            quoteReceived, quoteReserve, tokenReserve, reservedTokens, feeBps, additionalQuoteFeeBps, 0, minTokensOut
        );
    }

    function quoteBuyWithCreatorTax(
        uint256 quoteReceived,
        uint256 quoteReserve,
        uint256 tokenReserve,
        uint256 reservedTokens,
        uint256 feeBps,
        uint256 additionalQuoteFeeBps,
        uint256 creatorTaxBps,
        uint256 minTokensOut
    ) internal pure returns (BuyQuote memory quote) {
        uint256 totalFeeBps = _validatedTotalFee(feeBps, additionalQuoteFeeBps + creatorTaxBps);
        if (tokenReserve <= reservedTokens) {
            revert InsufficientSellableLiquidity(tokenReserve, reservedTokens);
        }

        quote.quoteReceived = quoteReceived;
        quote.quoteSpent = quoteReceived;
        (quote.fee, quote.additionalQuoteFee, quote.netQuote) =
            _netAfterFees(quote.quoteSpent, feeBps, additionalQuoteFeeBps);
        quote.creatorTaxFee = Math.mulDiv(quote.quoteSpent, creatorTaxBps, BPS_DENOMINATOR);
        quote.netQuote -= quote.creatorTaxFee;
        quote.tokensOut = amountOut(quote.netQuote, quoteReserve, tokenReserve, 0);

        uint256 sellableTokens = tokenReserve - reservedTokens;
        if (quote.tokensOut > sellableTokens) {
            quote.partialFill = true;
            quote.tokensOut = sellableTokens;
            quote.netRequired = amountIn(sellableTokens, quoteReserve, tokenReserve, 0);
            uint256 grossRequired =
                Math.mulDiv(quote.netRequired, BPS_DENOMINATOR, BPS_DENOMINATOR - totalFeeBps, Math.Rounding.Ceil);
            quote.quoteSpent = Math.min(grossRequired, quoteReceived);
            (quote.fee, quote.additionalQuoteFee, quote.netQuote) =
                _netAfterFees(quote.quoteSpent, feeBps, additionalQuoteFeeBps);
            quote.creatorTaxFee = Math.mulDiv(quote.quoteSpent, creatorTaxBps, BPS_DENOMINATOR);
            quote.netQuote -= quote.creatorTaxFee;
        }

        quote.refund = quoteReceived - quote.quoteSpent;
        quote.slippagePass = quote.partialFill
            ? proportionalSlippagePass(quote.quoteSpent, minTokensOut, quoteReceived, quote.tokensOut)
            : quote.tokensOut >= minTokensOut;
    }

    function quoteSell(
        uint256 tokensIn,
        uint256 tokenReserve,
        uint256 quoteReserve,
        uint256 feeBps,
        uint256 additionalQuoteFeeBps,
        uint256 minQuoteOut
    ) internal pure returns (SellQuote memory quote) {
        _validatedTotalFee(feeBps, additionalQuoteFeeBps);
        quote.tokensIn = tokensIn;
        quote.grossQuoteOut = amountOut(tokensIn, tokenReserve, quoteReserve, 0);
        (quote.fee, quote.additionalQuoteFee, quote.quoteOut) =
            _netAfterFees(quote.grossQuoteOut, feeBps, additionalQuoteFeeBps);
        quote.slippagePass = quote.quoteOut >= minQuoteOut;
    }

    function proportionalSlippagePass(
        uint256 quoteSpent,
        uint256 minTokensOut,
        uint256 quoteReceived,
        uint256 tokensOut
    ) internal pure returns (bool) {
        return _productLte(quoteSpent, minTokensOut, quoteReceived, tokensOut);
    }

    function _validatedTotalFee(uint256 feeBps, uint256 additionalQuoteFeeBps)
        private
        pure
        returns (uint256 totalFeeBps)
    {
        if (feeBps >= BPS_DENOMINATOR) revert InvalidFeeBps(feeBps);
        if (additionalQuoteFeeBps >= BPS_DENOMINATOR) revert InvalidFeeBps(additionalQuoteFeeBps);
        totalFeeBps = _checkedAdd(feeBps, additionalQuoteFeeBps);
        if (totalFeeBps >= BPS_DENOMINATOR) {
            revert InvalidCombinedFeeBps(feeBps, additionalQuoteFeeBps);
        }
    }

    function _netAfterFees(uint256 gross, uint256 feeBps, uint256 additionalQuoteFeeBps)
        private
        pure
        returns (uint256 fee, uint256 additionalQuoteFee, uint256 net)
    {
        fee = Math.mulDiv(gross, feeBps, BPS_DENOMINATOR);
        additionalQuoteFee = Math.mulDiv(gross, additionalQuoteFeeBps, BPS_DENOMINATOR);
        net = gross - fee - additionalQuoteFee;
    }

    /// @dev Compares a*b <= c*d without narrowing either 512-bit product.
    function _productLte(uint256 a, uint256 b, uint256 c, uint256 d) private pure returns (bool) {
        (uint256 leftHigh, uint256 leftLow) = _fullProduct(a, b);
        (uint256 rightHigh, uint256 rightLow) = _fullProduct(c, d);
        return leftHigh < rightHigh || (leftHigh == rightHigh && leftLow <= rightLow);
    }

    function _fullProduct(uint256 a, uint256 b) private pure returns (uint256 high, uint256 low) {
        assembly ("memory-safe") {
            let mm := mulmod(a, b, not(0))
            low := mul(a, b)
            high := sub(sub(mm, low), lt(mm, low))
        }
    }

    function _checkedAdd(uint256 a, uint256 b) private pure returns (uint256 result) {
        unchecked {
            result = a + b;
        }
        if (result < a) revert ArithmeticOverflow();
    }

    function _checkedMul(uint256 a, uint256 b) private pure returns (uint256 result) {
        if (a != 0 && b > type(uint256).max / a) revert ArithmeticOverflow();
        result = a * b;
    }
}
