// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";

import {TickerGardenAntiSnipe} from "../../../src/v1/libraries/TickerGardenAntiSnipe.sol";

contract TickerGardenAntiSnipeHarness {
    address internal constant CREATOR = address(0xC0FFEE);
    address internal constant BENEFICIARY = address(0xBEEF);
    address internal constant LAUNCH_ROUTER = address(0xB007);

    function isExempt(
        address recipient,
        address caller,
        address creator,
        address beneficiaryAtCreation,
        address launchRouter,
        address atomicFirstBuyRecipient
    ) external pure returns (bool) {
        return TickerGardenAntiSnipe.isExempt(
            recipient,
            caller,
            TickerGardenAntiSnipe.ExemptionContext(
                creator, beneficiaryAtCreation, launchRouter, atomicFirstBuyRecipient
            )
        );
    }

    function elapsedSince(uint256 currentTimestamp, uint256 launchTimestamp) external pure returns (uint256) {
        return TickerGardenAntiSnipe.elapsedSince(currentTimestamp, launchTimestamp);
    }

    function rawSnipeBps(uint256 elapsedSeconds, bool exempt) external pure returns (uint256) {
        return TickerGardenAntiSnipe.rawSnipeBps(elapsedSeconds, exempt);
    }

    function effectiveSnipeBps(uint256 elapsedSeconds, bool exempt, uint256 feeBps)
        external
        pure
        returns (uint256, uint256)
    {
        return TickerGardenAntiSnipe.effectiveSnipeBps(elapsedSeconds, exempt, feeBps);
    }

    function quoteBuy(uint256 elapsedSeconds, address recipient, address caller, address atomicFirstBuyRecipient)
        external
        pure
        returns (TickerGardenAntiSnipe.AntiSnipeBuyQuote memory)
    {
        return TickerGardenAntiSnipe.quoteBuy(
            1_000,
            1_000,
            1_000_000,
            1,
            100,
            0,
            1_000 + elapsedSeconds,
            1_000,
            recipient,
            caller,
            TickerGardenAntiSnipe.ExemptionContext(CREATOR, BENEFICIARY, LAUNCH_ROUTER, atomicFirstBuyRecipient)
        );
    }
}

contract TickerGardenAntiSnipeTest is Test {
    address internal constant CREATOR = address(0xC0FFEE);
    address internal constant BENEFICIARY = address(0xBEEF);
    address internal constant FIRST_BUY_RECIPIENT = address(0xF1757);
    address internal constant ORDINARY_RECIPIENT = address(0xA11CE);
    address internal constant LAUNCH_ROUTER = address(0xB007);
    address internal constant ORDINARY_CALLER = address(0xCA11);

    TickerGardenAntiSnipeHarness internal harness;

    function setUp() public {
        harness = new TickerGardenAntiSnipeHarness();
    }

    function test_elapsedZeroMatchesClippedRuntimeVector() public view {
        TickerGardenAntiSnipe.AntiSnipeBuyQuote memory quote =
            _quote(0, ORDINARY_RECIPIENT, ORDINARY_CALLER, address(0));
        assertEq(quote.rawSnipeBps, 9_900);
        assertEq(quote.effectiveSnipeBps, 9_800);
        assertEq(quote.curveQuote.fee, 10);
        assertEq(quote.curveQuote.additionalQuoteFee, 980);
        assertEq(quote.curveQuote.netQuote, 10);
        assertEq(quote.curveQuote.tokensOut, 9_900);
    }

    function test_elapsedOneMatchesFiveSecondPolicy() public view {
        TickerGardenAntiSnipe.AntiSnipeBuyQuote memory quote =
            _quote(1, ORDINARY_RECIPIENT, ORDINARY_CALLER, address(0));
        assertEq(quote.rawSnipeBps, 2475);
        assertEq(quote.effectiveSnipeBps, 2475);
        assertEq(quote.curveQuote.fee, 10);
        assertEq(quote.curveQuote.additionalQuoteFee, 247);
        assertEq(quote.curveQuote.netQuote, 743);
        assertEq(quote.curveQuote.tokensOut, 426276);
    }

    function test_elapsedTwoMatchesFiveSecondPolicy() public view {
        TickerGardenAntiSnipe.AntiSnipeBuyQuote memory quote =
            _quote(2, ORDINARY_RECIPIENT, ORDINARY_CALLER, address(0));
        assertEq(quote.rawSnipeBps, 309);
        assertEq(quote.effectiveSnipeBps, 309);
        assertEq(quote.curveQuote.fee, 10);
        assertEq(quote.curveQuote.additionalQuoteFee, 30);
        assertEq(quote.curveQuote.netQuote, 960);
        assertEq(quote.curveQuote.tokensOut, 489795);
    }

    function test_elapsedFiveAndLaterAreExactlyZero() public view {
        _assertNoSnipe(_quote(5, ORDINARY_RECIPIENT, ORDINARY_CALLER, address(0)));
        _assertNoSnipe(_quote(6, ORDINARY_RECIPIENT, ORDINARY_CALLER, address(0)));
        assertEq(harness.rawSnipeBps(type(uint256).max, false), 0);
    }

    function test_creatorIsAlwaysAutomaticallyExempt() public view {
        TickerGardenAntiSnipe.AntiSnipeBuyQuote memory quote = _quote(0, CREATOR, ORDINARY_CALLER, address(0));
        assertTrue(quote.exempt);
        _assertNoSnipe(quote);
    }

    function test_frozenBeneficiaryIsAlwaysAutomaticallyExempt() public view {
        TickerGardenAntiSnipe.AntiSnipeBuyQuote memory quote = _quote(0, BENEFICIARY, ORDINARY_CALLER, address(0));
        assertTrue(quote.exempt);
        _assertNoSnipe(quote);
    }

    function test_atomicFirstBuyRecipientIsExemptOnlyWhenContextSuppliesIt() public view {
        TickerGardenAntiSnipe.AntiSnipeBuyQuote memory atomicQuote =
            _quote(0, FIRST_BUY_RECIPIENT, LAUNCH_ROUTER, FIRST_BUY_RECIPIENT);
        assertTrue(atomicQuote.exempt);
        _assertNoSnipe(atomicQuote);

        TickerGardenAntiSnipe.AntiSnipeBuyQuote memory ordinaryQuote =
            _quote(0, FIRST_BUY_RECIPIENT, ORDINARY_CALLER, FIRST_BUY_RECIPIENT);
        assertFalse(ordinaryQuote.exempt);
        assertEq(ordinaryQuote.effectiveSnipeBps, 9_800);
    }

    function test_ordinaryRecipientCannotGainExemptionFromUnrelatedIdentities() public view {
        assertFalse(
            harness.isExempt(
                ORDINARY_RECIPIENT, ORDINARY_CALLER, CREATOR, BENEFICIARY, LAUNCH_ROUTER, FIRST_BUY_RECIPIENT
            )
        );
    }

    function test_capPreservesFrozenMinimumNetAcrossFeeRange() public view {
        (uint256 raw, uint256 effective) = harness.effectiveSnipeBps(0, false, 9_899);
        assertEq(raw, 9_900);
        assertEq(effective, 1);

        (raw, effective) = harness.effectiveSnipeBps(0, false, 9_900);
        assertEq(raw, 9_900);
        assertEq(effective, 0);
    }

    function test_feeCannotConsumeFrozenMinimumNet() public {
        vm.expectRevert(
            abi.encodeWithSelector(
                TickerGardenAntiSnipe.FeeLeavesLessThanMinimumNet.selector, uint256(9_901), uint256(100)
            )
        );
        harness.effectiveSnipeBps(0, false, 9_901);
    }

    function test_zeroRecipientAndMissingFrozenIdentitiesFailClosed() public {
        vm.expectRevert(abi.encodeWithSelector(TickerGardenAntiSnipe.InvalidRecipient.selector, address(0)));
        harness.isExempt(address(0), ORDINARY_CALLER, CREATOR, BENEFICIARY, LAUNCH_ROUTER, address(0));

        vm.expectRevert(
            abi.encodeWithSelector(TickerGardenAntiSnipe.InvalidFrozenIdentity.selector, address(0), BENEFICIARY)
        );
        harness.isExempt(ORDINARY_RECIPIENT, ORDINARY_CALLER, address(0), BENEFICIARY, LAUNCH_ROUTER, address(0));

        vm.expectRevert(
            abi.encodeWithSelector(TickerGardenAntiSnipe.InvalidFrozenIdentity.selector, CREATOR, address(0))
        );
        harness.isExempt(ORDINARY_RECIPIENT, ORDINARY_CALLER, CREATOR, address(0), LAUNCH_ROUTER, address(0));

        vm.expectRevert(abi.encodeWithSelector(TickerGardenAntiSnipe.InvalidLaunchRouter.selector, address(0)));
        harness.isExempt(ORDINARY_RECIPIENT, ORDINARY_CALLER, CREATOR, BENEFICIARY, address(0), address(0));
    }

    function test_elapsedUsesCheckedLaunchTimestampDifference() public {
        assertEq(harness.elapsedSince(1_003, 1_000), 3);
        vm.expectRevert(
            abi.encodeWithSelector(TickerGardenAntiSnipe.TimestampBeforeLaunch.selector, uint256(999), uint256(1_000))
        );
        harness.elapsedSince(999, 1_000);
    }

    function test_exactFiveSecondBoundaryTable() public view {
        uint256[7] memory expected = [uint256(9900), 2475, 309, 19, 1, 0, 0];
        for (uint256 i; i < expected.length; ++i) {
            assertEq(harness.rawSnipeBps(i, false), expected[i]);
            assertEq(harness.rawSnipeBps(i, true), 0);
        }
    }

    function testFuzz_scheduleHasNoInterpolation(uint256 elapsedSeconds) public view {
        uint256 expected;
        if (elapsedSeconds == 0) expected = 9_900;
        else if (elapsedSeconds == 1) expected = 2475;
        else if (elapsedSeconds == 2) expected = 309;
        else if (elapsedSeconds == 3) expected = 19;
        else if (elapsedSeconds == 4) expected = 1;
        assertEq(harness.rawSnipeBps(elapsedSeconds, false), expected);
    }

    function _quote(uint256 elapsedSeconds, address recipient, address caller, address atomicFirstBuyRecipient)
        private
        view
        returns (TickerGardenAntiSnipe.AntiSnipeBuyQuote memory)
    {
        return harness.quoteBuy(elapsedSeconds, recipient, caller, atomicFirstBuyRecipient);
    }

    function _assertNoSnipe(TickerGardenAntiSnipe.AntiSnipeBuyQuote memory quote) private pure {
        assertEq(quote.rawSnipeBps, 0);
        assertEq(quote.effectiveSnipeBps, 0);
        assertEq(quote.curveQuote.fee, 10);
        assertEq(quote.curveQuote.additionalQuoteFee, 0);
        assertEq(quote.curveQuote.netQuote, 990);
        assertEq(quote.curveQuote.tokensOut, 497_487);
    }
}
