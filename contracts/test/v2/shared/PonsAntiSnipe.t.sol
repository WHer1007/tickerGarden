// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";

import {PonsAntiSnipe} from "../../../src/v2/libraries/PonsAntiSnipe.sol";

contract PonsAntiSnipeHarness {
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
        return PonsAntiSnipe.isExempt(
            recipient,
            caller,
            PonsAntiSnipe.ExemptionContext(creator, beneficiaryAtCreation, launchRouter, atomicFirstBuyRecipient)
        );
    }

    function elapsedSince(uint256 currentTimestamp, uint256 launchTimestamp) external pure returns (uint256) {
        return PonsAntiSnipe.elapsedSince(currentTimestamp, launchTimestamp);
    }

    function rawSnipeBps(uint256 elapsedSeconds, bool exempt) external pure returns (uint256) {
        return PonsAntiSnipe.rawSnipeBps(elapsedSeconds, exempt);
    }

    function effectiveSnipeBps(uint256 elapsedSeconds, bool exempt, uint256 feeBps)
        external
        pure
        returns (uint256, uint256)
    {
        return PonsAntiSnipe.effectiveSnipeBps(elapsedSeconds, exempt, feeBps);
    }

    function quoteBuy(uint256 elapsedSeconds, address recipient, address caller, address atomicFirstBuyRecipient)
        external
        pure
        returns (PonsAntiSnipe.AntiSnipeBuyQuote memory)
    {
        return PonsAntiSnipe.quoteBuy(
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
            PonsAntiSnipe.ExemptionContext(CREATOR, BENEFICIARY, LAUNCH_ROUTER, atomicFirstBuyRecipient)
        );
    }
}

contract PonsAntiSnipeTest is Test {
    address internal constant CREATOR = address(0xC0FFEE);
    address internal constant BENEFICIARY = address(0xBEEF);
    address internal constant FIRST_BUY_RECIPIENT = address(0xF1757);
    address internal constant ORDINARY_RECIPIENT = address(0xA11CE);
    address internal constant LAUNCH_ROUTER = address(0xB007);
    address internal constant ORDINARY_CALLER = address(0xCA11);

    PonsAntiSnipeHarness internal harness;

    function setUp() public {
        harness = new PonsAntiSnipeHarness();
    }

    function test_elapsedZeroMatchesClippedRuntimeVector() public view {
        PonsAntiSnipe.AntiSnipeBuyQuote memory quote = _quote(0, ORDINARY_RECIPIENT, ORDINARY_CALLER, address(0));
        assertEq(quote.rawSnipeBps, 9_900);
        assertEq(quote.effectiveSnipeBps, 9_800);
        assertEq(quote.curveQuote.fee, 10);
        assertEq(quote.curveQuote.additionalQuoteFee, 980);
        assertEq(quote.curveQuote.netQuote, 10);
        assertEq(quote.curveQuote.tokensOut, 9_900);
    }

    function test_elapsedOneMatchesRuntimeVector() public view {
        PonsAntiSnipe.AntiSnipeBuyQuote memory quote = _quote(1, ORDINARY_RECIPIENT, ORDINARY_CALLER, address(0));
        assertEq(quote.rawSnipeBps, 618);
        assertEq(quote.effectiveSnipeBps, 618);
        assertEq(quote.curveQuote.fee, 10);
        assertEq(quote.curveQuote.additionalQuoteFee, 61);
        assertEq(quote.curveQuote.netQuote, 929);
        assertEq(quote.curveQuote.tokensOut, 481_596);
    }

    function test_elapsedTwoMatchesRuntimeVector() public view {
        PonsAntiSnipe.AntiSnipeBuyQuote memory quote = _quote(2, ORDINARY_RECIPIENT, ORDINARY_CALLER, address(0));
        assertEq(quote.rawSnipeBps, 19);
        assertEq(quote.effectiveSnipeBps, 19);
        assertEq(quote.curveQuote.fee, 10);
        assertEq(quote.curveQuote.additionalQuoteFee, 1);
        assertEq(quote.curveQuote.netQuote, 989);
        assertEq(quote.curveQuote.tokensOut, 497_234);
    }

    function test_elapsedThreeAndLaterAreExactlyZero() public view {
        _assertNoSnipe(_quote(3, ORDINARY_RECIPIENT, ORDINARY_CALLER, address(0)));
        _assertNoSnipe(_quote(4, ORDINARY_RECIPIENT, ORDINARY_CALLER, address(0)));
        assertEq(harness.rawSnipeBps(type(uint256).max, false), 0);
    }

    function test_creatorIsAlwaysAutomaticallyExempt() public view {
        PonsAntiSnipe.AntiSnipeBuyQuote memory quote = _quote(0, CREATOR, ORDINARY_CALLER, address(0));
        assertTrue(quote.exempt);
        _assertNoSnipe(quote);
    }

    function test_frozenBeneficiaryIsAlwaysAutomaticallyExempt() public view {
        PonsAntiSnipe.AntiSnipeBuyQuote memory quote = _quote(0, BENEFICIARY, ORDINARY_CALLER, address(0));
        assertTrue(quote.exempt);
        _assertNoSnipe(quote);
    }

    function test_atomicFirstBuyRecipientIsExemptOnlyWhenContextSuppliesIt() public view {
        PonsAntiSnipe.AntiSnipeBuyQuote memory atomicQuote =
            _quote(0, FIRST_BUY_RECIPIENT, LAUNCH_ROUTER, FIRST_BUY_RECIPIENT);
        assertTrue(atomicQuote.exempt);
        _assertNoSnipe(atomicQuote);

        PonsAntiSnipe.AntiSnipeBuyQuote memory ordinaryQuote =
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
            abi.encodeWithSelector(PonsAntiSnipe.FeeLeavesLessThanMinimumNet.selector, uint256(9_901), uint256(100))
        );
        harness.effectiveSnipeBps(0, false, 9_901);
    }

    function test_zeroRecipientAndMissingFrozenIdentitiesFailClosed() public {
        vm.expectRevert(abi.encodeWithSelector(PonsAntiSnipe.InvalidRecipient.selector, address(0)));
        harness.isExempt(address(0), ORDINARY_CALLER, CREATOR, BENEFICIARY, LAUNCH_ROUTER, address(0));

        vm.expectRevert(abi.encodeWithSelector(PonsAntiSnipe.InvalidFrozenIdentity.selector, address(0), BENEFICIARY));
        harness.isExempt(ORDINARY_RECIPIENT, ORDINARY_CALLER, address(0), BENEFICIARY, LAUNCH_ROUTER, address(0));

        vm.expectRevert(abi.encodeWithSelector(PonsAntiSnipe.InvalidFrozenIdentity.selector, CREATOR, address(0)));
        harness.isExempt(ORDINARY_RECIPIENT, ORDINARY_CALLER, CREATOR, address(0), LAUNCH_ROUTER, address(0));

        vm.expectRevert(abi.encodeWithSelector(PonsAntiSnipe.InvalidLaunchRouter.selector, address(0)));
        harness.isExempt(ORDINARY_RECIPIENT, ORDINARY_CALLER, CREATOR, BENEFICIARY, address(0), address(0));
    }

    function test_elapsedUsesCheckedLaunchTimestampDifference() public {
        assertEq(harness.elapsedSince(1_003, 1_000), 3);
        vm.expectRevert(
            abi.encodeWithSelector(PonsAntiSnipe.TimestampBeforeLaunch.selector, uint256(999), uint256(1_000))
        );
        harness.elapsedSince(999, 1_000);
    }

    function testFuzz_scheduleHasNoInterpolation(uint256 elapsedSeconds) public view {
        uint256 expected;
        if (elapsedSeconds == 0) expected = 9_900;
        else if (elapsedSeconds == 1) expected = 618;
        else if (elapsedSeconds == 2) expected = 19;
        assertEq(harness.rawSnipeBps(elapsedSeconds, false), expected);
    }

    function _quote(uint256 elapsedSeconds, address recipient, address caller, address atomicFirstBuyRecipient)
        private
        view
        returns (PonsAntiSnipe.AntiSnipeBuyQuote memory)
    {
        return harness.quoteBuy(elapsedSeconds, recipient, caller, atomicFirstBuyRecipient);
    }

    function _assertNoSnipe(PonsAntiSnipe.AntiSnipeBuyQuote memory quote) private pure {
        assertEq(quote.rawSnipeBps, 0);
        assertEq(quote.effectiveSnipeBps, 0);
        assertEq(quote.curveQuote.fee, 10);
        assertEq(quote.curveQuote.additionalQuoteFee, 0);
        assertEq(quote.curveQuote.netQuote, 990);
        assertEq(quote.curveQuote.tokensOut, 497_487);
    }
}
