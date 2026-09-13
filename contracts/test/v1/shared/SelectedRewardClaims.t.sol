// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {UserRewardClaimsTest} from "./UserRewardClaims.t.sol";

contract SelectedRewardClaimsTest is UserRewardClaimsTest {
    function test_creatorMemeOnlyIgnoresBrokenQuoteBalanceAndTransfer() public {
        vm.mockCallRevert(address(q), abi.encodeWithSelector(IERC20.balanceOf.selector), bytes("PAUSED"));
        vm.mockCallRevert(address(q), abi.encodeWithSelector(IERC20.transfer.selector), bytes("PAUSED"));
        vm.prank(ALICE);
        (uint256 paid, uint256 raw) = v.claimUserRewardAssets(ID, 0, 1, 2);
        assertEq(paid, 0);
        assertEq(raw, 100);
        assertEq(v.creatorLiability(ID, 1, address(q)), 30);
        assertEq(v.creatorLiability(ID, 2, address(m)), 100);
        vm.clearMockedCalls();
        vm.prank(ALICE);
        (paid, raw) = v.claimUserRewardAssets(ID, 0, 1, 1);
        assertEq(paid, 30);
        assertEq(raw, 0);
    }

    function test_creatorQuoteOnlyIgnoresBrokenMemeBalance() public {
        vm.mockCallRevert(address(m), abi.encodeWithSelector(IERC20.balanceOf.selector), bytes("PAUSED"));
        vm.prank(ALICE);
        (uint256 paid, uint256 raw) = v.claimUserRewardAssets(ID, 0, 1, 1);
        assertEq(paid, 30);
        assertEq(raw, 0);
        assertEq(v.creatorLiability(ID, 1, address(m)), 100);
    }

    function test_memeOnlyDoesNotConsumeExistingQuote() public {
        vm.prank(ALICE);
        (, uint256 paid) = v.claimUserRewardAssets(ID, 0, 1, 2);
        assertEq(paid, 100);
        assertEq(v.creatorLiability(ID, 1, address(q)), 30);
        assertEq(q.balanceOf(address(v)), 60);
    }

    function test_memeOnlyDoesNotReadBrokenQuote() public {
        vm.mockCallRevert(address(q), abi.encodeWithSelector(IERC20.balanceOf.selector), bytes("PAUSED"));
        vm.prank(ALICE);
        (, uint256 raw) = v.claimUserRewardAssets(ID, 0, 1, 2);
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
        v.claimUserRewardAssets(ID, 1, 0, 2);
        g.setLock(false);
        vm.mockCallRevert(address(q), abi.encodeWithSelector(IERC20.balanceOf.selector), bytes("PAUSED"));
        vm.prank(ALICE);
        v.claimUserRewardAssets(ID, 1, 0, 2);
        assertEq(g.pending(ALICE, address(q)), 30);
        assertEq(g.pending(ALICE, address(m)), 0);
        vm.clearMockedCalls();
        vm.prank(ALICE);
        v.claimUserRewardAssets(ID, 1, 0, 1);
        assertEq(q.balanceOf(ALICE), 30);
    }

    function test_selectionCannotBypassAuthorizationOrUseInvalidMask() public {
        vm.prank(BOB);
        vm.expectRevert();
        v.claimUserRewardAssets(ID, 0, 1, 2);
        vm.prank(ALICE);
        vm.expectRevert();
        v.claimUserRewardAssets(ID, 0, 1, 0);
        vm.prank(ALICE);
        vm.expectRevert();
        v.claimUserRewardAssets(ID, 0, 1, 4);
    }
}
