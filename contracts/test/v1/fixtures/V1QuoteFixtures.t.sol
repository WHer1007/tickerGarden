// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {
    MockCallbackQuoteToken,
    MockExactQuoteToken,
    MockFeeOnTransferQuoteToken,
    MockForcedNativeSender,
    MockRebasingQuoteToken,
    MockReturnAnomalyQuoteToken,
    MockV1ExactBalanceReceiver
} from "../mocks/MockV1QuoteAssets.sol";

contract V1QuoteFixturesTest is Test {
    address internal constant USER = address(0xA11CE);
    uint256 internal constant AMOUNT = 1_000_000;

    MockV1ExactBalanceReceiver internal receiver;

    function setUp() public {
        receiver = new MockV1ExactBalanceReceiver();
    }

    function test_exactErc20TransfersTheDeclaredAmount() public {
        MockExactQuoteToken token = new MockExactQuoteToken(6);
        token.mint(USER, AMOUNT);
        vm.prank(USER);
        token.approve(address(receiver), AMOUNT);
        receiver.pull(address(token), USER, AMOUNT);
        assertEq(token.decimals(), 6);
        assertEq(token.balanceOf(address(receiver)), AMOUNT);
    }

    function test_feeOnTransferFailsExactBalanceDelta() public {
        MockFeeOnTransferQuoteToken token = new MockFeeOnTransferQuoteToken(6, 100);
        token.mint(USER, AMOUNT);
        vm.prank(USER);
        token.approve(address(receiver), AMOUNT);
        vm.expectRevert(
            abi.encodeWithSelector(MockV1ExactBalanceReceiver.InexactBalanceDelta.selector, AMOUNT, AMOUNT - 10_000)
        );
        receiver.pull(address(token), USER, AMOUNT);
    }

    function test_rebaseChangesBalanceWithoutTransfer() public {
        MockRebasingQuoteToken token = new MockRebasingQuoteToken(6);
        token.mint(address(receiver), AMOUNT);
        uint256 beforeBalance = token.balanceOf(address(receiver));
        token.simulateRebase(address(receiver), AMOUNT * 2);
        assertEq(beforeBalance, AMOUNT);
        assertEq(token.balanceOf(address(receiver)), AMOUNT * 2);
    }

    function test_transferCallbackCannotEnterExactBalanceReceiver() public {
        MockCallbackQuoteToken token = new MockCallbackQuoteToken(6);
        token.mint(USER, AMOUNT);
        vm.prank(USER);
        token.approve(address(receiver), AMOUNT);
        token.setCallbackEnabled(true);
        vm.expectRevert(MockV1ExactBalanceReceiver.TransferCallFailed.selector);
        receiver.pull(address(token), USER, AMOUNT);
        assertEq(token.balanceOf(USER), AMOUNT);
        assertEq(token.balanceOf(address(receiver)), 0);
    }

    function test_falseNoDataAndMalformedReturnAreRejected() public {
        MockReturnAnomalyQuoteToken token = new MockReturnAnomalyQuoteToken();
        vm.expectRevert(MockV1ExactBalanceReceiver.InvalidTransferReturn.selector);
        receiver.pull(address(token), USER, AMOUNT);

        token.setMode(MockReturnAnomalyQuoteToken.ReturnMode.NO_DATA);
        vm.expectRevert(MockV1ExactBalanceReceiver.InvalidTransferReturn.selector);
        receiver.pull(address(token), USER, AMOUNT);

        token.setMode(MockReturnAnomalyQuoteToken.ReturnMode.MALFORMED_TRUE);
        vm.expectRevert(MockV1ExactBalanceReceiver.InvalidTransferReturn.selector);
        receiver.pull(address(token), USER, AMOUNT);
    }

    function test_forcedNativeTransferChangesBalanceWithoutCallingRecipient() public {
        MockForcedNativeSender sender = new MockForcedNativeSender{value: 1 ether}();
        assertEq(address(receiver).balance, 0);
        sender.force(payable(address(receiver)));
        assertEq(address(receiver).balance, 1 ether);
    }
}
