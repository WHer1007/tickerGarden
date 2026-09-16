// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";

import {TickerGardenBaseline, QuoteAssetConfig} from "../../../src/v1/interfaces/IV1Protocol.sol";
import {GraduationPoolMath} from "../../../src/v1/libraries/GraduationPoolMath.sol";
import {V1GraduationEconomicDomain} from "../../../src/v1/libraries/V1GraduationEconomicDomain.sol";

contract V1GraduationEconomicDomainHarness {
    function validate(TickerGardenBaseline memory baseline, QuoteAssetConfig memory quote) external pure {
        V1GraduationEconomicDomain.validate(baseline, quote);
    }
}

contract V1GraduationEconomicDomainTest is Test {
    uint256 private constant MAX_SIGNED = uint256(uint128(type(int128).max));
    address private constant QUOTE = address(0x2000);

    V1GraduationEconomicDomainHarness private harness;

    function setUp() public {
        harness = new V1GraduationEconomicDomainHarness();
    }

    function test_validNativeLikeConfigurationPasses() public view {
        harness.validate(_baseline(1_000_000 ether, 200), _quote(1 ether, 500_000 ether));
    }

    function test_supplyAboveInt128IsRejected() public {
        uint256 value = MAX_SIGNED + 1;
        vm.expectRevert(
            abi.encodeWithSelector(
                V1GraduationEconomicDomain.EconomicValueOutsideGraduationDomain.selector, value, 1 ether, 500_000 ether
            )
        );
        harness.validate(_baseline(value, 200), _quote(1 ether, 500_000 ether));
    }

    function test_phantomQuoteAboveInt128IsRejected() public {
        uint256 value = MAX_SIGNED + 1;
        vm.expectRevert(
            abi.encodeWithSelector(
                V1GraduationEconomicDomain.EconomicValueOutsideGraduationDomain.selector,
                1_000_000 ether,
                value,
                500_000 ether
            )
        );
        harness.validate(_baseline(1_000_000 ether, 200), _quote(value, 500_000 ether));
    }

    function test_graduationThresholdAboveInt128IsRejected() public {
        uint256 value = MAX_SIGNED + 1;
        vm.expectRevert(
            abi.encodeWithSelector(
                V1GraduationEconomicDomain.EconomicValueOutsideGraduationDomain.selector,
                1_000_000 ether,
                1 ether,
                value
            )
        );
        harness.validate(_baseline(1_000_000 ether, 200), _quote(1 ether, value));
    }

    function test_tightTickSpacingRejectsMaximumLiquidityPlan() public {
        // All economic quantities remain in the signed V4 amount domain. At spacing 1,
        // the full-range per-tick cap is small enough that this otherwise representable
        // graduation plan is rejected by GraduationPoolMath's liquidity-domain check.
        uint256 threshold = MAX_SIGNED - 100;
        vm.expectRevert(
            abi.encodeWithSelector(
                GraduationPoolMath.InvalidGraduationLiquidity.selector,
                85_070_591_730_234_615_868_149_581_540_740_050_543,
                191_757_530_477_355_301_479_181_766_273_477
            )
        );
        harness.validate(_baseline(MAX_SIGNED, 1), _quote(MAX_SIGNED, threshold));
    }

    function _baseline(uint256 supply, int24 spacing) private pure returns (TickerGardenBaseline memory baseline) {
        baseline.supply = supply;
        baseline.tickSpacing = spacing;
    }

    function _quote(uint256 phantom, uint256 threshold) private pure returns (QuoteAssetConfig memory quote) {
        quote.quoteAsset = QUOTE;
        quote.phantomQuote = phantom;
        quote.graduationThreshold = threshold;
    }
}
