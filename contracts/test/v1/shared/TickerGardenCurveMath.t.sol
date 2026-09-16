// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";

import {TickerGardenCurveMath} from "../../../src/v1/libraries/TickerGardenCurveMath.sol";

contract TickerGardenCurveMathHarness {
    function amountOut(uint256 amountIn_, uint256 reserveIn, uint256 reserveOut, uint256 feeBps)
        external
        pure
        returns (uint256)
    {
        return TickerGardenCurveMath.amountOut(amountIn_, reserveIn, reserveOut, feeBps);
    }

    function amountIn(uint256 amountOut_, uint256 reserveIn, uint256 reserveOut, uint256 feeBps)
        external
        pure
        returns (uint256)
    {
        return TickerGardenCurveMath.amountIn(amountOut_, reserveIn, reserveOut, feeBps);
    }

    function quoteBuy(
        uint256 quoteReceived,
        uint256 quoteReserve,
        uint256 tokenReserve,
        uint256 reservedTokens,
        uint256 feeBps,
        uint256 additionalQuoteFeeBps,
        uint256 minTokensOut
    ) external pure returns (TickerGardenCurveMath.BuyQuote memory) {
        return TickerGardenCurveMath.quoteBuy(
            quoteReceived, quoteReserve, tokenReserve, reservedTokens, feeBps, additionalQuoteFeeBps, minTokensOut
        );
    }

    function quoteSell(
        uint256 tokensIn,
        uint256 tokenReserve,
        uint256 quoteReserve,
        uint256 feeBps,
        uint256 additionalQuoteFeeBps,
        uint256 minQuoteOut
    ) external pure returns (TickerGardenCurveMath.SellQuote memory) {
        return TickerGardenCurveMath.quoteSell(
            tokensIn, tokenReserve, quoteReserve, feeBps, additionalQuoteFeeBps, minQuoteOut
        );
    }

    function proportionalSlippagePass(uint256 a, uint256 b, uint256 c, uint256 d) external pure returns (bool) {
        return TickerGardenCurveMath.proportionalSlippagePass(a, b, c, d);
    }
}

contract TickerGardenCurveMathTest is Test {
    TickerGardenCurveMathHarness internal harness;

    function setUp() public {
        harness = new TickerGardenCurveMathHarness();
    }

    function test_amountOutMatchesFrozenIntegerFloorVector() public view {
        assertEq(harness.amountOut(99, 1_000, 1_000_000, 0), 90_081);
    }

    function test_amountInUsesMandatoryFloorPlusOne() public view {
        assertEq(harness.amountIn(90_081, 1_000, 1_000_000, 0), 99);
        assertEq(harness.amountOut(99, 1_000, 1_000_000, 0), 90_081);
        assertLt(harness.amountOut(98, 1_000, 1_000_000, 0), 90_081);
    }

    function test_buyChargesFeeBeforePricing() public view {
        TickerGardenCurveMath.BuyQuote memory quote = harness.quoteBuy(100, 1_000, 1_000_000, 1, 100, 0, 0);
        assertEq(quote.quoteReceived, 100);
        assertEq(quote.quoteSpent, 100);
        assertEq(quote.fee, 1);
        assertEq(quote.additionalQuoteFee, 0);
        assertEq(quote.netQuote, 99);
        assertEq(quote.tokensOut, 90_081);
        assertEq(quote.refund, 0);
        assertFalse(quote.partialFill);
        assertTrue(quote.slippagePass);
    }

    function test_buyFloorsTwoFeeLegsSeparately() public view {
        TickerGardenCurveMath.BuyQuote memory quote = harness.quoteBuy(1_000, 1_000, 1_000_000, 1, 100, 50, 0);
        assertEq(quote.fee, 10);
        assertEq(quote.additionalQuoteFee, 5);
        assertEq(quote.netQuote, 985);
        assertEq(quote.tokensOut, 496_221);
    }

    function test_sellChargesFeesAfterGrossPricing() public view {
        TickerGardenCurveMath.SellQuote memory quote = harness.quoteSell(500_000, 1_000_000, 1_000, 100, 50, 0);
        assertEq(quote.grossQuoteOut, 333);
        assertEq(quote.fee, 3);
        assertEq(quote.additionalQuoteFee, 1);
        assertEq(quote.quoteOut, 329);
        assertTrue(quote.slippagePass);
    }

    function test_tailQuoteRepricesFeesAndReturnsUnusedQuote() public view {
        TickerGardenCurveMath.BuyQuote memory quote = harness.quoteBuy(1_000, 1_000, 400_000, 333_333, 100, 50, 100_000);
        assertEq(quote.netRequired, 201);
        assertEq(quote.quoteSpent, 205);
        assertEq(quote.fee, 2);
        assertEq(quote.additionalQuoteFee, 1);
        assertEq(quote.netQuote, 202);
        assertEq(quote.tokensOut, 66_667);
        assertEq(quote.refund, 795);
        assertTrue(quote.partialFill);
        assertTrue(quote.slippagePass);
    }

    function test_tailQuoteUsesProportionalSlippage() public view {
        TickerGardenCurveMath.BuyQuote memory quote = harness.quoteBuy(1_000, 1_000, 400_000, 333_333, 100, 50, 400_000);
        assertTrue(quote.partialFill);
        assertFalse(quote.slippagePass);
    }

    function test_quoteAndExecutionMathUseTheSameResultPath() public view {
        TickerGardenCurveMath.BuyQuote memory preview = harness.quoteBuy(777, 5_000, 2_000_000, 100, 123, 77, 1);
        TickerGardenCurveMath.BuyQuote memory execution = harness.quoteBuy(777, 5_000, 2_000_000, 100, 123, 77, 1);
        assertEq(keccak256(abi.encode(preview)), keccak256(abi.encode(execution)));

        TickerGardenCurveMath.SellQuote memory sellPreview = harness.quoteSell(555, 2_000_000, 5_000, 123, 77, 1);
        TickerGardenCurveMath.SellQuote memory sellExecution = harness.quoteSell(555, 2_000_000, 5_000, 123, 77, 1);
        assertEq(keccak256(abi.encode(sellPreview)), keccak256(abi.encode(sellExecution)));
    }

    function test_slippageComparisonHandlesOverflowingProductsAndEquality() public view {
        uint256 large = type(uint256).max;
        assertTrue(harness.proportionalSlippagePass(large, large, large, large));
        assertTrue(harness.proportionalSlippagePass(large - 1, large, large, large));
        assertFalse(harness.proportionalSlippagePass(large, large, large - 1, large));
    }

    function test_invalidAmountsReservesAndFeesFailClosed() public {
        vm.expectRevert(abi.encodeWithSelector(TickerGardenCurveMath.InvalidAmountIn.selector, uint256(0)));
        harness.amountOut(0, 1, 1, 0);

        vm.expectRevert(abi.encodeWithSelector(TickerGardenCurveMath.InvalidAmountOut.selector, uint256(0)));
        harness.amountIn(0, 1, 2, 0);

        vm.expectRevert(abi.encodeWithSelector(TickerGardenCurveMath.InvalidReserves.selector, uint256(1), uint256(1)));
        harness.amountIn(1, 1, 1, 0);

        vm.expectRevert(abi.encodeWithSelector(TickerGardenCurveMath.InvalidFeeBps.selector, uint256(10_000)));
        harness.amountOut(1, 1, 2, 10_000);

        vm.expectRevert(
            abi.encodeWithSelector(TickerGardenCurveMath.InvalidCombinedFeeBps.selector, uint256(9_999), uint256(1))
        );
        harness.quoteBuy(10_000, 1, 10_000, 1, 9_999, 1, 0);
    }

    function test_zeroRoundedOutputAndEmptySellableLiquidityFailClosed() public {
        vm.expectRevert(TickerGardenCurveMath.AmountOutRoundsToZero.selector);
        harness.amountOut(1, type(uint128).max, 1, 0);

        vm.expectRevert(
            abi.encodeWithSelector(
                TickerGardenCurveMath.InsufficientSellableLiquidity.selector, uint256(100), uint256(100)
            )
        );
        harness.quoteBuy(1, 1, 100, 100, 0, 0, 0);
    }

    function test_scaledIntermediateOverflowFailsClosed() public {
        vm.expectRevert(TickerGardenCurveMath.ArithmeticOverflow.selector);
        harness.amountOut(type(uint256).max, 1, 1, 0);

        vm.expectRevert(TickerGardenCurveMath.ArithmeticOverflow.selector);
        harness.amountIn(1, type(uint256).max, 2, 0);
    }

    function testFuzz_amountInUsesTickerGardenFloorPlusOneAndMeetsDesiredOutput(
        uint64 reserveInSeed,
        uint64 reserveOutSeed,
        uint64 outputSeed,
        uint16 feeSeed
    ) public view {
        uint256 reserveIn = bound(uint256(reserveInSeed), 1, type(uint64).max);
        uint256 reserveOut = bound(uint256(reserveOutSeed), 2, type(uint64).max);
        uint256 desired = bound(uint256(outputSeed), 1, reserveOut - 1);
        uint256 feeBps = bound(uint256(feeSeed), 0, 9_999);
        uint256 required = harness.amountIn(desired, reserveIn, reserveOut, feeBps);

        uint256 actual = harness.amountOut(required, reserveIn, reserveOut, feeBps);
        assertGe(actual, desired);
        if (required > 1) {
            try harness.amountOut(required - 1, reserveIn, reserveOut, feeBps) returns (uint256 previous) {
                // TickerGarden always adds one even when the inverse division is exact, so equality is permitted here.
                assertLe(previous, desired);
            } catch (bytes memory reason) {
                assertEq(bytes4(reason), TickerGardenCurveMath.AmountOutRoundsToZero.selector);
            }
        }
    }
}
