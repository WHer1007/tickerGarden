// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {UserRewardClaimsTest} from "./UserRewardClaims.t.sol";
import {ContinuousHolderFeeFlowTest} from "./ContinuousHolderFeeFlow.t.sol";

contract SelectedRewardClaimsTest is UserRewardClaimsTest {
    function test_creatorMemeOnlyIgnoresBrokenQuoteBalanceAndTransfer() public {
        vm.mockCallRevert(address(q), abi.encodeWithSelector(IERC20.balanceOf.selector), bytes("PAUSED"));
        vm.mockCallRevert(address(q), abi.encodeWithSelector(IERC20.transfer.selector), bytes("PAUSED"));
        vm.prank(ALICE);
        (uint256 paid, uint256 raw,) = v.claimUserRewardAssets(ID, 0, 1, 2, false, false, 0);
        assertEq(paid, 0);
        assertEq(raw, 100);
        assertEq(v.creatorLiability(ID, 1, address(q)), 30);
        assertEq(v.creatorLiability(ID, 2, address(m)), 100);
        vm.clearMockedCalls();
        vm.prank(ALICE);
        (paid, raw,) = v.claimUserRewardAssets(ID, 0, 1, 1, false, false, 0);
        assertEq(paid, 30);
        assertEq(raw, 0);
    }

    function test_creatorQuoteOnlyIgnoresBrokenMemeBalance() public {
        vm.mockCallRevert(address(m), abi.encodeWithSelector(IERC20.balanceOf.selector), bytes("PAUSED"));
        vm.prank(ALICE);
        (uint256 paid, uint256 raw,) = v.claimUserRewardAssets(ID, 0, 1, 1, true, false, 0);
        assertEq(paid, 30);
        assertEq(raw, 0);
        assertEq(v.creatorLiability(ID, 1, address(m)), 100);
    }

    function test_memeOnlyConversionDoesNotConsumeExistingQuote() public {
        vm.prank(ALICE);
        (uint256 paid,,) = v.claimUserRewardAssets(ID, 0, 1, 2, true, false, block.timestamp + 240);
        assertEq(paid, 200);
        assertEq(v.creatorLiability(ID, 1, address(q)), 30);
        assertEq(q.balanceOf(address(v)), 60);
    }

    function test_memeOnlyConversionBrokenQuoteFallsBackWithoutReadingItAgain() public {
        vm.mockCallRevert(address(q), abi.encodeWithSelector(IERC20.balanceOf.selector), bytes("PAUSED"));
        vm.prank(ALICE);
        (, uint256 raw,) = v.claimUserRewardAssets(ID, 0, 1, 2, true, true, block.timestamp + 240);
        assertEq(raw, 100);
        assertEq(v.creatorLiability(ID, 1, address(q)), 30);
    }

    function test_stakerSelectedConsumptionKeepsOtherLedgerAndLock() public {
        m.mint(address(v), 100);
        q.mint(address(v), 30);
        v.seed(ID, 1, address(m), 100, false);
        v.seed(ID, 1, address(q), 30, false);
        g.set(ALICE, address(m), 100);
        g.set(ALICE, address(q), 30);
        g.setLock(true);
        vm.prank(ALICE);
        vm.expectRevert();
        v.claimUserRewardAssets(ID, 1, 0, 2, false, false, 0);
        g.setLock(false);
        vm.mockCallRevert(address(q), abi.encodeWithSelector(IERC20.balanceOf.selector), bytes("PAUSED"));
        vm.prank(ALICE);
        v.claimUserRewardAssets(ID, 1, 0, 2, false, false, 0);
        assertEq(g.pending(ALICE, address(q)), 30);
        assertEq(g.pending(ALICE, address(m)), 0);
        vm.clearMockedCalls();
        vm.prank(ALICE);
        v.claimUserRewardAssets(ID, 1, 0, 1, false, false, 0);
        assertEq(q.balanceOf(ALICE), 30);
    }

    function test_selectionCannotBypassAuthorizationOrUseInvalidMask() public {
        vm.prank(BOB);
        vm.expectRevert();
        v.claimUserRewardAssets(ID, 0, 1, 2, false, false, 0);
        vm.prank(ALICE);
        vm.expectRevert();
        v.claimUserRewardAssets(ID, 0, 1, 0, false, false, 0);
        vm.prank(ALICE);
        vm.expectRevert();
        v.claimUserRewardAssets(ID, 0, 1, 4, false, false, 0);
    }
}

contract SelectedHolderClaimsTest is ContinuousHolderFeeFlowTest {
    function _fundBoth() private {
        _credit(100_000_000, 10_000_000);
        vault.fundHolderRewards(ID, 1);
        meme.transfer(address(vault), 10 ether);
        vm.startPrank(address(vault));
        meme.approve(address(rewards), 10 ether);
        rewards.fundMemeFees(ID, 10 ether);
        vm.stopPrank();
        vm.warp(block.timestamp + 24 hours);
    }

    function test_holderMemeOnlyThroughRealVaultIgnoresFailedQuote() public {
        _fundBoth();
        (uint256 expectedQ, uint256 expectedM) = rewards.claimableAssets(ID, ALICE);
        vm.mockCallRevert(address(quote), abi.encodeWithSelector(IERC20.balanceOf.selector), bytes("PAUSED"));
        vm.prank(ALICE);
        (uint256 paid, uint256 raw,) = vault.claimUserRewardAssets(ID, 2, 0, 2, false, false, 0);
        assertEq(paid, 0);
        assertEq(raw, expectedM);
        vm.clearMockedCalls();
        (uint256 remainingQ, uint256 remainingM) = rewards.claimableAssets(ID, ALICE);
        assertEq(remainingQ, expectedQ);
        assertEq(remainingM, 0);
        vm.prank(ALICE);
        vault.claimUserRewardAssets(ID, 2, 0, 1, false, false, 0);
        assertEq(quote.balanceOf(ALICE), expectedQ);
    }

    function test_holderQuoteOnlyNeverTransfersMemeOrDebitsMemeRights() public {
        _fundBoth();
        (uint256 expectedQ, uint256 expectedM) = rewards.claimableAssets(ID, ALICE);
        vm.mockCallRevert(address(meme), abi.encodeWithSelector(IERC20.transfer.selector), bytes("PAUSED"));
        vm.prank(ALICE);
        (uint256 paid, uint256 raw,) = vault.claimUserRewardAssets(ID, 2, 0, 1, false, false, 0);
        assertEq(paid, expectedQ);
        assertEq(raw, 0);
        (uint256 remainingQ, uint256 remainingM) = rewards.claimableAssets(ID, ALICE);
        assertEq(remainingQ, 0);
        assertEq(remainingM, expectedM);
        vm.prank(ALICE);
        (paid,,) = vault.claimUserRewardAssets(ID, 2, 0, 1, false, false, 0);
        assertEq(paid, 0);
    }
}
