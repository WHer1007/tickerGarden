// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";

import {MarketFeeAccounting} from "../../../src/v2/libraries/MarketFeeAccounting.sol";

contract MarketFeeAccountingHarness {
    function splitV4(
        uint256 totalFee,
        uint256 lpAmount,
        uint256 nonLpAmount,
        uint256 activeStock,
        uint256 stakeSaturationAmount
    ) external pure returns (MarketFeeAccounting.V4Buckets memory) {
        return MarketFeeAccounting.splitV4(totalFee, lpAmount, nonLpAmount, activeStock, stakeSaturationAmount);
    }

    function splitCurve(uint256 amount) external pure returns (MarketFeeAccounting.CurveBuckets memory) {
        return MarketFeeAccounting.splitCurve(amount);
    }
}

contract MarketFeeAccountingTest is Test {
    uint256 private constant B = 10 ether;
    MarketFeeAccountingHarness private accounting;

    function setUp() public {
        accounting = new MarketFeeAccountingHarness();
    }

    function test_zeroActiveStockProducesExactFortyZeroFortyTwentySplit() public view {
        MarketFeeAccounting.V4Buckets memory buckets = accounting.splitV4(10 ether, 2 ether, 8 ether, 0, B);
        assertEq(buckets.creatorAmount, 4 ether);
        assertEq(buckets.stakerAmount, 0);
        assertEq(buckets.platformAmount, 4 ether);
        assertEq(buckets.effectiveActiveStock, 0);
    }

    function test_halfSaturationProducesExactThirtyTwentyThirtyTwentySplit() public view {
        MarketFeeAccounting.V4Buckets memory buckets = accounting.splitV4(10 ether, 2 ether, 8 ether, B / 2, B);
        assertEq(buckets.creatorAmount, 3 ether);
        assertEq(buckets.stakerAmount, 2 ether);
        assertEq(buckets.platformAmount, 3 ether);
        assertEq(buckets.effectiveActiveStock, B / 2);
    }

    function test_atAndAboveSaturationCapAtExactTwentyFortyTwentyTwentySplit() public view {
        MarketFeeAccounting.V4Buckets memory atCap = accounting.splitV4(10 ether, 2 ether, 8 ether, B, B);
        MarketFeeAccounting.V4Buckets memory aboveCap =
            accounting.splitV4(10 ether, 2 ether, 8 ether, type(uint256).max, B);
        assertEq(atCap.creatorAmount, 2 ether);
        assertEq(atCap.stakerAmount, 4 ether);
        assertEq(atCap.platformAmount, 2 ether);
        assertEq(atCap.effectiveActiveStock, B);
        assertEq(aboveCap.creatorAmount, atCap.creatorAmount);
        assertEq(aboveCap.stakerAmount, atCap.stakerAmount);
        assertEq(aboveCap.platformAmount, atCap.platformAmount);
        assertEq(aboveCap.effectiveActiveStock, B);
    }

    function test_allIntegerRemaindersGoToPlatform() public view {
        MarketFeeAccounting.V4Buckets memory buckets = accounting.splitV4(7, 1, 6, B, B);
        assertEq(buckets.stakerAmount, 3);
        assertEq(buckets.creatorAmount, 1);
        assertEq(buckets.platformAmount, 2);
        assertEq(buckets.creatorAmount + buckets.stakerAmount + buckets.platformAmount, 6);

        MarketFeeAccounting.CurveBuckets memory curve = accounting.splitCurve(7);
        assertEq(curve.creatorAmount, 3);
        assertEq(curve.platformAmount, 4);
    }

    function test_rejectsZeroOrOverflowingSaturation() public {
        vm.expectRevert(abi.encodeWithSelector(MarketFeeAccounting.InvalidStakeSaturationAmount.selector, 0));
        accounting.splitV4(0, 0, 0, 0, 0);

        uint256 invalid = type(uint256).max / 2 + 1;
        vm.expectRevert(abi.encodeWithSelector(MarketFeeAccounting.InvalidStakeSaturationAmount.selector, invalid));
        accounting.splitV4(0, 0, 0, 0, invalid);
    }

    function test_rejectsAnyMismatchInTotalLpOrNonLpPartition() public {
        vm.expectRevert(abi.encodeWithSelector(MarketFeeAccounting.InvalidV4FeePartition.selector, 100, 19, 81, 20));
        accounting.splitV4(100, 19, 81, 0, B);

        vm.expectRevert(abi.encodeWithSelector(MarketFeeAccounting.InvalidV4FeePartition.selector, 100, 20, 79, 20));
        accounting.splitV4(100, 20, 79, 0, B);

        vm.expectRevert(abi.encodeWithSelector(MarketFeeAccounting.InvalidV4FeePartition.selector, 1, 2, 0, 0));
        accounting.splitV4(1, 2, 0, 0, B);
    }

    function test_maximumTotalFeeDoesNotOverflowTheLpPartition() public view {
        uint256 totalFee = type(uint256).max;
        uint256 lpAmount = totalFee / 5;
        uint256 nonLpAmount = totalFee - lpAmount;
        MarketFeeAccounting.V4Buckets memory buckets = accounting.splitV4(totalFee, lpAmount, nonLpAmount, B, B);
        assertEq(buckets.stakerAmount, nonLpAmount / 2);
        assertEq(buckets.creatorAmount + buckets.stakerAmount + buckets.platformAmount, nonLpAmount);
    }

    function test_eachApprovedStockDecimalsHasExactZeroBelowAtAndAboveSaturationVectors() public view {
        for (uint8 decimals = 6; decimals <= 18; ++decimals) {
            uint256 saturation = 10 * (10 ** uint256(decimals));
            uint256 totalFee = 5 * saturation;
            uint256 lpAmount = saturation;
            uint256 nonLpAmount = 4 * saturation;

            MarketFeeAccounting.V4Buckets memory zero =
                accounting.splitV4(totalFee, lpAmount, nonLpAmount, 0, saturation);
            MarketFeeAccounting.V4Buckets memory one =
                accounting.splitV4(totalFee, lpAmount, nonLpAmount, 1, saturation);
            MarketFeeAccounting.V4Buckets memory below =
                accounting.splitV4(totalFee, lpAmount, nonLpAmount, saturation - 1, saturation);
            MarketFeeAccounting.V4Buckets memory atCap =
                accounting.splitV4(totalFee, lpAmount, nonLpAmount, saturation, saturation);
            MarketFeeAccounting.V4Buckets memory above =
                accounting.splitV4(totalFee, lpAmount, nonLpAmount, saturation + 1, saturation);

            assertEq(zero.stakerAmount, 0);
            assertEq(zero.creatorAmount, 2 * saturation);
            assertEq(zero.platformAmount, 2 * saturation);
            assertEq(one.stakerAmount, 2);
            assertEq(one.creatorAmount, 2 * saturation - 1);
            assertEq(one.platformAmount, 2 * saturation - 1);
            assertEq(below.stakerAmount, 2 * saturation - 2);
            assertEq(below.creatorAmount, saturation + 1);
            assertEq(below.platformAmount, saturation + 1);
            assertEq(atCap.stakerAmount, 2 * saturation);
            assertEq(atCap.creatorAmount, saturation);
            assertEq(atCap.platformAmount, saturation);
            assertEq(above.stakerAmount, atCap.stakerAmount);
            assertEq(above.creatorAmount, atCap.creatorAmount);
            assertEq(above.platformAmount, atCap.platformAmount);
            assertEq(above.effectiveActiveStock, saturation);
        }
    }

    function testFuzz_v4BucketsConserveEveryUnitAndMatchFrozenFormula(
        uint128 totalFeeSeed,
        uint128 activeStockSeed,
        uint96 saturationSeed
    ) public view {
        uint256 totalFee = uint256(totalFeeSeed);
        uint256 saturation = bound(uint256(saturationSeed), 1, type(uint96).max);
        uint256 activeStock = uint256(activeStockSeed);
        uint256 lpAmount = totalFee / 5;
        uint256 nonLpAmount = totalFee - lpAmount;
        MarketFeeAccounting.V4Buckets memory buckets =
            accounting.splitV4(totalFee, lpAmount, nonLpAmount, activeStock, saturation);

        uint256 effective = activeStock < saturation ? activeStock : saturation;
        assertEq(buckets.effectiveActiveStock, effective);
        assertEq(buckets.stakerAmount, (nonLpAmount * effective) / (2 * saturation));
        assertEq(buckets.creatorAmount + buckets.stakerAmount + buckets.platformAmount, nonLpAmount);
        assertGe(buckets.platformAmount, buckets.creatorAmount);
        assertLe(buckets.platformAmount - buckets.creatorAmount, 1);
    }

    function testFuzz_curveBucketsConserveAndAssignOddUnitToPlatform(uint256 amount) public view {
        MarketFeeAccounting.CurveBuckets memory buckets = accounting.splitCurve(amount);
        assertEq(buckets.creatorAmount + buckets.platformAmount, amount);
        assertGe(buckets.platformAmount, buckets.creatorAmount);
        assertLe(buckets.platformAmount - buckets.creatorAmount, 1);
    }
}
