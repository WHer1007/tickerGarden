// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Audit20260905RewardsTest} from "./Audit20260905.t.sol";

/// @notice Regression coverage for reward-cohort boundaries that are observed late.
contract RewardCohortBoundaryTest is Audit20260905RewardsTest {
    function _stake(address user, uint256 amount) private {
        stock.mint(user, amount);
        vm.startPrank(user);
        stock.approve(address(vault), amount);
        manager.stake(MARKET_A, amount);
        vm.stopPrank();
    }

    function test_pendingSurvivesLastExitButCannotInheritOldRemainder() public {
        _stake(ALICE, 1000 * 1e27);
        vm.warp(block.timestamp + 31);
        feeVault.credit(gaugeA, address(quote), 999, keccak256("old"));
        _stake(BOB, 1 ether); // pending before Alice is the last active position

        vm.prank(ALICE);
        vault.rageQuit(ASSET_UID, MARKET_A);
        vm.warp(block.timestamp + 31);
        gaugeA.checkpointActivations();
        feeVault.credit(gaugeA, address(quote), 1, keccak256("new"));

        assertEq(gaugeA.positionOf(BOB).quoteClaimable, 1);
        manager.settleRageQuitRewards(MARKET_A, ALICE);
        assertEq(feeVault.recordedQuoteForfeiture(), 999);
    }

    function test_quoteAndMemeRemaindersAreBothBoundToTheEndedCohort() public {
        _stake(ALICE, 1000 * 1e27);
        vm.warp(block.timestamp + 31);
        address meme = gaugeA.gaugeIdentity().memeToken;
        feeVault.credit(gaugeA, address(quote), 999, keccak256("old-quote"));
        feeVault.credit(gaugeA, meme, 777, keccak256("old-meme"));
        _stake(BOB, 1 ether);
        vm.prank(ALICE);
        vault.rageQuit(ASSET_UID, MARKET_A);
        vm.warp(block.timestamp + 31);
        feeVault.credit(gaugeA, address(quote), 1, keccak256("new-quote"));
        feeVault.credit(gaugeA, meme, 2, keccak256("new-meme"));
        assertEq(gaugeA.positionOf(BOB).quoteClaimable, 1);
        assertEq(gaugeA.positionOf(BOB).memeClaimable, 2);
        manager.settleRageQuitRewards(MARKET_A, ALICE);
        gaugeA.checkpointActivations();
        assertEq(feeVault.recordedQuoteForfeiture(), 999);
        assertEq(feeVault.recordedMemeForfeiture(), 777);
    }

    function test_failedReserveFlushCannotExposeOldDustAndRetryDoesNotDoubleCount() public {
        _stake(ALICE, 1000 * 1e27);
        vm.warp(block.timestamp + 31);
        feeVault.credit(gaugeA, address(quote), 999, keccak256("old"));
        _stake(BOB, 1 ether);
        feeVault.setRecordForfeitureShouldRevert(true);
        vm.prank(ALICE);
        vault.rageQuit(ASSET_UID, MARKET_A);
        assertEq(stock.balanceOf(ALICE), 1000 * 1e27);
        vm.warp(block.timestamp + 31);
        gaugeA.checkpointActivations();
        (uint256 deferred,) = gaugeA.deferredForfeiture();
        assertEq(deferred, 999);
        feeVault.credit(gaugeA, address(quote), 1, keccak256("new"));
        assertEq(gaugeA.positionOf(BOB).quoteClaimable, 1);
        manager.settleRageQuitRewards(MARKET_A, ALICE);
        feeVault.setRecordForfeitureShouldRevert(false);
        gaugeA.checkpointActivations();
        gaugeA.checkpointActivations();
        assertEq(feeVault.recordedQuoteForfeiture(), 999);
        (deferred,) = gaugeA.deferredForfeiture();
        assertEq(deferred, 0);
    }

    function test_survivingActiveWeightDoesNotEndCohortOrDiscardItsCarry() public {
        _stake(ALICE, 1000 * 1e27);
        _stake(BOB, 1 ether);
        vm.warp(block.timestamp + 31);
        feeVault.credit(gaugeA, address(quote), 999, keccak256("old"));
        vm.prank(ALICE);
        vault.rageQuit(ASSET_UID, MARKET_A);
        assertEq(manager.rewardCohortEpoch(MARKET_A), 0);
        gaugeA.checkpointActivations();
        assertEq(feeVault.recordedQuoteForfeiture(), 0);
        feeVault.credit(gaugeA, address(quote), 1, keccak256("new"));
        assertEq(gaugeA.positionOf(BOB).quoteClaimable, 1000);
    }

    function test_directGaugeCreditAlsoIsolatesOldRemainder() public {
        _stake(ALICE, 1000 * 1e27);
        vm.warp(block.timestamp + 31);
        feeVault.credit(gaugeA, address(quote), 999, keccak256("old"));
        _stake(BOB, 1 ether);
        vm.prank(ALICE);
        vault.rageQuit(ASSET_UID, MARKET_A);
        assertEq(manager.rewardCohortEpoch(MARKET_A), 1);
        vm.warp(block.timestamp + 31);

        // This is the direct FeeVault credit path (the gauge rejects arbitrary callers).
        feeVault.credit(gaugeA, address(quote), 1, keccak256("direct"));
        assertEq(gaugeA.positionOf(BOB).quoteClaimable, 1);
        gaugeA.checkpointActivations();
        manager.settleRageQuitRewards(MARKET_A, ALICE);
        assertEq(feeVault.recordedQuoteForfeiture(), 999);
    }

    function test_multipleUnobservedZeroCrossingsReserveWhenFinallyCheckpointed() public {
        _stake(ALICE, 1000 * 1e27);
        vm.warp(block.timestamp + 31);
        feeVault.credit(gaugeA, address(quote), 999, keccak256("old"));
        _stake(BOB, 1 ether);
        vm.prank(ALICE);
        vault.rageQuit(ASSET_UID, MARKET_A);
        assertEq(manager.rewardCohortEpoch(MARKET_A), 1);

        // The pending bucket matures, then crosses a second zero-active boundary before the gauge is called.
        vm.warp(block.timestamp + 31);
        vm.prank(BOB);
        vault.rageQuit(ASSET_UID, MARKET_A);
        assertEq(manager.rewardCohortEpoch(MARKET_A), 2);
        gaugeA.checkpointActivations();
        assertEq(gaugeA.rewardState(address(quote)).indexRemainder, 0);
        manager.settleRageQuitRewards(MARKET_A, ALICE);
        assertEq(feeVault.recordedQuoteForfeiture(), 999);
    }

    function test_existingImmediateCleanupRegressionRemainsGreen() public {
        _stake(ALICE, 1000 * 1e27);
        vm.warp(block.timestamp + 31);
        feeVault.credit(gaugeA, address(quote), 999, keccak256("old"));
        vm.prank(ALICE);
        vault.rageQuit(ASSET_UID, MARKET_A);
        manager.settleRageQuitRewards(MARKET_A, ALICE);
        _stake(BOB, 1 ether);
        vm.warp(block.timestamp + 31);
        feeVault.credit(gaugeA, address(quote), 1, keccak256("new"));
        assertEq(gaugeA.positionOf(BOB).quoteClaimable, 1);
    }
}
