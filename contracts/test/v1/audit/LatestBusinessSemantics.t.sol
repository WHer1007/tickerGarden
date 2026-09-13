// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {HolderSnapshotRewardsTest} from "../treasury/product/HolderSnapshotRewards.t.sol";
import {HolderRewardsDistributorV1 as Rewards} from "../../../src/v1/modules/HolderRewardsDistributorV1.sol";
import {MemeFeeBurnTest} from "./MemeFeeBurn.t.sol";

/// @notice Reproduces trusted-publisher mistakes and policy boundaries, not public exploits.
contract LatestSnapshotBusinessReviewTest is HolderSnapshotRewardsTest {
    function testLatestReview_overBudgetLeafPermanentlyReservesUnclaimableBudget() public {
        _fund(1 ether, 0);
        _publish(_publication(r.claimLeaf(ID, 1, ALICE, 2 ether, 0), 1 ether, 0));
        vm.expectRevert(Rewards.BudgetExceeded.selector);
        _claim(ALICE, 2 ether, 0, 1);
        assertEq(r.marketState(ID).unallocatedQuote, 0);
        assertEq(r.roundState(ID, 1).quoteRemaining, 1 ether);
        assertEq(r.totalLiability(address(0)), 1 ether);

        Rewards.Publication[] memory next = new Rewards.Publication[](1);
        next[0] = Rewards.Publication(ID, 2, 1001, keccak256("next block"),
            r.claimLeaf(ID, 2, ALICE, 1 ether, 0), keccak256("corrected data"), 1 ether, 0);
        vm.prank(PUBLISHER);
        vm.expectRevert(Rewards.BudgetExceeded.selector);
        r.publishSnapshots(next);
    }

    function testLatestReview_revokingPublisherCannotStopAlreadyPublishedWrongRecipient() public {
        _fund(1 ether, 0);
        assertEq(token.balanceOf(BOB), 0);
        _publish(_publication(r.claimLeaf(ID, 1, BOB, 1 ether, 0), 1 ether, 0));
        manager.grantRole(2, address(this), 0);
        r.revokeSnapshotPublisher(PUBLISHER);
        assertEq(r.snapshotPublisher(), address(0));
        _claim(BOB, 1 ether, 0, 1);
        assertEq(BOB.balance, 1 ether);
    }

    function testLatestReview_laterFeesCanBeAllocatedToOldSnapshot() public {
        vm.roll(1500);
        vm.prank(ALICE);
        token.transfer(BOB, 100 ether);
        _fund(1 ether, 0); // All funding arrives after ALICE sold.
        _publish(_publication(r.claimLeaf(ID, 1, ALICE, 1 ether, 0), 1 ether, 0));
        assertEq(token.balanceOf(ALICE), 0);
        _claim(ALICE, 1 ether, 0, 1);
        assertEq(ALICE.balance, 1 ether);
    }
}

contract LatestBurnBusinessReviewTest is MemeFeeBurnTest {
    function testLatestReview_forfeitedStakerMemeBecomesPlatformRevenueWithoutBurn() public {
        uint256 supply = token.totalSupply();
        // Isolate the authenticated FeeVault endpoint reached by Gauge rageQuit cleanup.
        vm.prank(address(gauge));
        vault.recordForfeiture(ID, ALICE, 0, 200);
        assertEq(vault.forfeitureReserve(ID, address(token)), 200);
        assertEq(vault.liability(ID, address(token), 1), 0);
        assertEq(vault.claimPlatform(ID, address(token)), 500);
        assertEq(token.balanceOf(address(0x7000)), 500);
        assertEq(token.totalSupply(), supply);
    }
}
