// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

import {PonsSupplyMath} from "../../../src/v1/libraries/PonsSupplyMath.sol";

contract PonsSupplyMathHarness {
    PonsSupplyMath.TrackedReserves internal _state;
    uint256 public unsolicitedTokenBalance;
    uint256 public unsolicitedQuoteBalance;

    function initialize(uint256 supply, uint256 phantomQuote, uint256 graduationThreshold) external {
        _state = PonsSupplyMath.initialize(supply, phantomQuote, graduationThreshold);
    }

    function setTrackedQuote(uint256 trackedQuote, uint256 accruedQuoteFees) external {
        _state.trackedQuote = trackedQuote;
        _state.accruedQuoteFees = accruedQuoteFees;
    }

    function setTrackedTokens(uint256 trackedTokens) external {
        _state.trackedTokens = trackedTokens;
    }

    function forceBalances(uint256 tokenAmount, uint256 quoteAmount) external {
        unsolicitedTokenBalance += tokenAmount;
        unsolicitedQuoteBalance += quoteAmount;
    }

    function supplyPartition(uint256 supply, uint256 phantomQuote, uint256 graduationThreshold)
        external
        pure
        returns (uint256, uint256)
    {
        return PonsSupplyMath.supplyPartition(supply, phantomQuote, graduationThreshold);
    }

    function graduationPartition(uint256 sweptTokens, uint256 sweptQuote, uint256 phantomQuote)
        external
        pure
        returns (uint256, uint256)
    {
        return PonsSupplyMath.graduationPartition(sweptTokens, sweptQuote, phantomQuote);
    }

    function sellableTokens() external view returns (uint256) {
        return PonsSupplyMath.sellableTokens(_state);
    }

    function pricingReserves(uint256 phantomQuote) external view returns (uint256, uint256) {
        return PonsSupplyMath.pricingReserves(_state, phantomQuote);
    }

    function state() external view returns (PonsSupplyMath.TrackedReserves memory) {
        return _state;
    }
}

contract PonsSupplyMathTest is Test {
    uint256 internal constant SUPPLY = 1_000_000_000 ether;
    uint256 internal constant RESERVED = 285_714_285_714_285_714_285_714_285;
    uint256 internal constant SELLABLE = 714_285_714_285_714_285_714_285_715;

    PonsSupplyMathHarness internal harness;

    function setUp() public {
        harness = new PonsSupplyMathHarness();
    }

    function test_nativeSupplyPartitionMatchesFrozenPonsVector() public view {
        (uint256 reserved, uint256 sellable) = harness.supplyPartition(SUPPLY, 1.68 ether, 4.2 ether);
        assertEq(reserved, RESERVED);
        assertEq(sellable, SELLABLE);
    }

    function test_usdgSupplyPartitionMatchesFrozenPonsVector() public view {
        (uint256 reserved, uint256 sellable) = harness.supplyPartition(SUPPLY, 3_236_000_000, 8_090_000_000);
        assertEq(reserved, RESERVED);
        assertEq(sellable, SELLABLE);
    }

    function test_graduationPartitionMatchesFrozenPonsVector() public view {
        (uint256 poolMeme, uint256 lockedExcess) = harness.graduationPartition(RESERVED, 4.2 ether, 1.68 ether);
        assertEq(poolMeme, 204_081_632_653_061_224_489_795_917);
        assertEq(lockedExcess, 81_632_653_061_224_489_795_918_368);
        assertEq(poolMeme + lockedExcess, RESERVED);
    }

    function test_fullPrecisionPartitionDoesNotOverflowTheIntermediateProduct() public view {
        uint256 supply = type(uint256).max - 1;
        (uint256 reserved, uint256 sellable) = harness.supplyPartition(supply, type(uint128).max, type(uint128).max);
        assertEq(reserved, supply / 2);
        assertEq(reserved + sellable, supply);

        (uint256 poolMeme, uint256 locked) = harness.graduationPartition(supply, type(uint128).max, type(uint128).max);
        assertEq(poolMeme, supply / 2);
        assertEq(poolMeme + locked, supply);
    }

    function test_invalidOrDegenerateSupplyPartitionsFailClosed() public {
        _expectInvalidSupply(0, 1, 1);
        _expectInvalidSupply(100, 0, 1);
        _expectInvalidSupply(100, 1, 0);
        _expectInvalidSupply(1, 1, 2);
        _expectInvalidSupply(100, type(uint256).max, 1);
    }

    function test_invalidOrDegenerateGraduationPartitionsFailClosed() public {
        _expectInvalidGraduation(0, 1, 1);
        _expectInvalidGraduation(100, 0, 1);
        _expectInvalidGraduation(100, 1, 0);
        _expectInvalidGraduation(1, 1, 2);
        _expectInvalidGraduation(100, type(uint256).max, 1);
    }

    function test_initialTrackedAccountingEqualsSupplyAndNeverReadsForcedBalances() public {
        harness.initialize(SUPPLY, 1.68 ether, 4.2 ether);
        PonsSupplyMath.TrackedReserves memory state = harness.state();
        assertEq(state.trackedTokens, SUPPLY);
        assertEq(state.reservedTokens, RESERVED);
        assertEq(harness.sellableTokens(), SELLABLE);

        (uint256 quoteBefore, uint256 tokenBefore) = harness.pricingReserves(1.68 ether);
        harness.forceBalances(777 ether, 888 ether);
        (uint256 quoteAfter, uint256 tokenAfter) = harness.pricingReserves(1.68 ether);
        assertEq(quoteAfter, quoteBefore);
        assertEq(tokenAfter, tokenBefore);
    }

    function test_pricingQuoteReserveExcludesAccruedFees() public {
        harness.initialize(SUPPLY, 1.68 ether, 4.2 ether);
        harness.setTrackedQuote(10 ether, 0.25 ether);
        (uint256 quoteReserve, uint256 tokenReserve) = harness.pricingReserves(1.68 ether);
        assertEq(quoteReserve, 11.43 ether);
        assertEq(tokenReserve, SUPPLY);
    }

    function test_trackedTokensCannotCrossReservedFloor() public {
        harness.initialize(SUPPLY, 1.68 ether, 4.2 ether);
        harness.setTrackedTokens(RESERVED);
        assertEq(harness.sellableTokens(), 0);

        harness.setTrackedTokens(RESERVED - 1);
        vm.expectRevert(
            abi.encodeWithSelector(PonsSupplyMath.TrackedTokensBelowReserve.selector, RESERVED - 1, RESERVED)
        );
        harness.sellableTokens();
    }

    function test_accruedFeesCannotExceedTrackedQuote() public {
        harness.initialize(SUPPLY, 1.68 ether, 4.2 ether);
        harness.setTrackedQuote(99, 100);
        vm.expectRevert(
            abi.encodeWithSelector(PonsSupplyMath.AccruedFeesExceedTrackedQuote.selector, uint256(99), uint256(100))
        );
        harness.pricingReserves(1.68 ether);
    }

    function testFuzz_supplyPartitionAlwaysConservesSupply(
        uint128 supplySeed,
        uint128 phantomSeed,
        uint128 thresholdSeed
    ) public view {
        uint256 supply = bound(uint256(supplySeed), 2, type(uint128).max);
        uint256 phantom = bound(uint256(phantomSeed), 1, type(uint128).max);
        uint256 threshold = bound(uint256(thresholdSeed), 1, type(uint128).max);
        uint256 reserved = Math.mulDiv(supply, phantom, phantom + threshold);
        if (reserved == 0) return;

        (uint256 actualReserved, uint256 sellable) = harness.supplyPartition(supply, phantom, threshold);
        assertEq(actualReserved, reserved);
        assertGt(actualReserved, 0);
        assertLt(actualReserved, supply);
        assertEq(actualReserved + sellable, supply);
    }

    function _expectInvalidSupply(uint256 supply, uint256 phantom, uint256 threshold) private {
        vm.expectRevert(
            abi.encodeWithSelector(PonsSupplyMath.InvalidSupplyPartition.selector, supply, phantom, threshold)
        );
        harness.supplyPartition(supply, phantom, threshold);
    }

    function _expectInvalidGraduation(uint256 sweptTokens, uint256 sweptQuote, uint256 phantom) private {
        vm.expectRevert(
            abi.encodeWithSelector(PonsSupplyMath.InvalidGraduationPartition.selector, sweptTokens, sweptQuote, phantom)
        );
        harness.graduationPartition(sweptTokens, sweptQuote, phantom);
    }
}
