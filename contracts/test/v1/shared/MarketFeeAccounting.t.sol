// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";

import {MarketFeeAccounting} from "../../../src/v1/libraries/MarketFeeAccounting.sol";

contract MarketFeeAccountingHarness {
    function splitV4(uint256 totalFee, uint256 lpAmount, uint256 nonLpAmount, uint256 activeStock)
        external
        pure
        returns (MarketFeeAccounting.V4Buckets memory)
    {
        return MarketFeeAccounting.splitV4(totalFee, lpAmount, nonLpAmount, activeStock);
    }

    function splitCurve(uint256 amount) external pure returns (MarketFeeAccounting.CurveBuckets memory) {
        return MarketFeeAccounting.splitCurve(amount);
    }
}

contract MarketFeeAccountingTest is Test {
    MarketFeeAccountingHarness private accounting;

    function setUp() public {
        accounting = new MarketFeeAccountingHarness();
    }

    function test_zeroActiveStockProducesExactSeventyZeroThirtySplit() public view {
        MarketFeeAccounting.V4Buckets memory buckets = accounting.splitV4(10 ether, 0, 10 ether, 0);
        assertEq(buckets.creatorAmount, 7 ether);
        assertEq(buckets.stakerAmount, 0);
        assertEq(buckets.platformAmount, 3 ether);
    }

    function test_oneActiveStockProducesFixedFortyThirtyThirtySplit() public view {
        MarketFeeAccounting.V4Buckets memory buckets = accounting.splitV4(10 ether, 0, 10 ether, 1);
        assertEq(buckets.creatorAmount, 4 ether);
        assertEq(buckets.stakerAmount, 3 ether);
        assertEq(buckets.platformAmount, 3 ether);
    }

    function test_maximumActiveStockProducesSameFixedSplit() public view {
        MarketFeeAccounting.V4Buckets memory atCap = accounting.splitV4(10 ether, 0, 10 ether, 1);
        MarketFeeAccounting.V4Buckets memory aboveCap = accounting.splitV4(10 ether, 0, 10 ether, type(uint256).max);
        assertEq(atCap.creatorAmount, 4 ether);
        assertEq(atCap.stakerAmount, 3 ether);
        assertEq(atCap.platformAmount, 3 ether);
        assertEq(aboveCap.creatorAmount, atCap.creatorAmount);
        assertEq(aboveCap.stakerAmount, atCap.stakerAmount);
        assertEq(aboveCap.platformAmount, atCap.platformAmount);
    }

    function test_allIntegerRemaindersGoToCreator() public view {
        MarketFeeAccounting.V4Buckets memory buckets = accounting.splitV4(7, 0, 7, 1);
        assertEq(buckets.stakerAmount, 2);
        assertEq(buckets.creatorAmount, 3);
        assertEq(buckets.platformAmount, 2);
        assertEq(buckets.creatorAmount + buckets.stakerAmount + buckets.platformAmount, 7);

        MarketFeeAccounting.CurveBuckets memory curve = accounting.splitCurve(7);
        assertEq(curve.creatorAmount, 5);
        assertEq(curve.platformAmount, 2);
    }

    function test_acceptsZeroActiveStockWithoutSaturationParameter() public {
        accounting.splitV4(0, 0, 0, 0);
    }

    function test_rejectsAnyMismatchInTotalLpOrNonLpPartition() public {
        vm.expectRevert(abi.encodeWithSelector(MarketFeeAccounting.InvalidV4FeePartition.selector, 100, 19, 81, 0));
        accounting.splitV4(100, 19, 81, 0);

        vm.expectRevert(abi.encodeWithSelector(MarketFeeAccounting.InvalidV4FeePartition.selector, 100, 20, 79, 0));
        accounting.splitV4(100, 20, 79, 0);

        vm.expectRevert(abi.encodeWithSelector(MarketFeeAccounting.InvalidV4FeePartition.selector, 1, 2, 0, 0));
        accounting.splitV4(1, 2, 0, 0);
    }

    function test_maximumTotalFeeDoesNotOverflowTheLpPartition() public view {
        uint256 totalFee = type(uint256).max;
        uint256 lpAmount = 0;
        uint256 nonLpAmount = totalFee;
        MarketFeeAccounting.V4Buckets memory buckets = accounting.splitV4(totalFee, lpAmount, nonLpAmount, 1);
        uint256 expectedStaker = (nonLpAmount / 100) * 30 + ((nonLpAmount % 100) * 30 / 100);
        assertEq(buckets.stakerAmount, expectedStaker);
        assertEq(buckets.creatorAmount + buckets.stakerAmount + buckets.platformAmount, nonLpAmount);
    }

    function test_eachApprovedStockDecimalsHasExactZeroAndPositiveActiveVectors() public view {
        for (uint8 decimals = 6; decimals <= 18; ++decimals) {
            uint256 totalFee = 5 * (10 ** uint256(decimals));
            uint256 lpAmount = 0;
            uint256 nonLpAmount = totalFee;

            MarketFeeAccounting.V4Buckets memory zero = accounting.splitV4(totalFee, lpAmount, nonLpAmount, 0);
            MarketFeeAccounting.V4Buckets memory one = accounting.splitV4(totalFee, lpAmount, nonLpAmount, 1);
            MarketFeeAccounting.V4Buckets memory above =
                accounting.splitV4(totalFee, lpAmount, nonLpAmount, type(uint256).max);

            assertEq(zero.stakerAmount, 0);
            assertEq(zero.creatorAmount, nonLpAmount * 70 / 100);
            assertEq(zero.platformAmount, nonLpAmount - zero.creatorAmount);
            assertEq(one.stakerAmount, nonLpAmount * 30 / 100);
            assertEq(one.creatorAmount + one.platformAmount, nonLpAmount - one.stakerAmount);
            assertEq(above.stakerAmount, one.stakerAmount);
            assertEq(above.creatorAmount, one.creatorAmount);
            assertEq(above.platformAmount, one.platformAmount);
        }
    }

    function testFuzz_v4BucketsConserveEveryUnitAndMatchFrozenFormula(uint128 totalFeeSeed, uint128 activeStockSeed)
        public
        view
    {
        uint256 totalFee = uint256(totalFeeSeed);
        uint256 activeStock = uint256(activeStockSeed);
        uint256 lpAmount = 0;
        uint256 nonLpAmount = totalFee;
        MarketFeeAccounting.V4Buckets memory buckets = accounting.splitV4(totalFee, lpAmount, nonLpAmount, activeStock);

        uint256 expectedStaker = activeStock == 0 ? 0 : nonLpAmount * 30 / 100;
        assertEq(buckets.stakerAmount, expectedStaker);
        assertEq(buckets.creatorAmount + buckets.stakerAmount + buckets.platformAmount, nonLpAmount);
        assertEq(buckets.creatorAmount, nonLpAmount - buckets.stakerAmount - buckets.platformAmount);
    }

    function testFuzz_curveBucketsConserveAndAssignRemainderToCreator(uint256 amount) public view {
        MarketFeeAccounting.CurveBuckets memory buckets = accounting.splitCurve(amount);
        assertEq(buckets.creatorAmount + buckets.platformAmount, amount);
        assertEq(buckets.platformAmount, (amount / 100) * 30 + ((amount % 100) * 30 / 100));
        assertEq(buckets.creatorAmount, amount - buckets.platformAmount);
    }
}
