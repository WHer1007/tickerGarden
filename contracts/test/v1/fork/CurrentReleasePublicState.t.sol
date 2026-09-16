// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {PositionView, IAllocationManager} from "../../../src/v1/interfaces/IV1Protocol.sol";

interface ILiveClaims {
    function claimUserRewardAssets(bytes32, uint8, uint32, uint8, bool, bool, uint256)
        external
        returns (uint256, uint256, uint256);
    function totalLiability(address) external view returns (uint256);
}

interface ILiveGauge {
    function positionOf(address) external view returns (PositionView memory);
}

interface ILiveHolder {
    function claimableAssets(bytes32, address) external view returns (uint256, uint256);
}

/// Runs against the freshly deployed testnet state, never mock redeployments.
/// Time is advanced only in Foundry's private fork; public locks remain unchanged.
contract CurrentReleasePublicStateTest is Test {
    ILiveClaims private vault;
    IAllocationManager private allocation;
    bytes32 private market;
    address private gauge;
    address private token;
    address private stock;
    address private bob;
    address private dave;
    address private holder;
    ILiveHolder private distributor;

    function setUp() public {
        require(block.chainid == 46630, "testnet fork required");
        vault = ILiveClaims(vm.envAddress("TG_LIVE_VAULT"));
        allocation = IAllocationManager(vm.envAddress("TG_LIVE_ALLOCATION"));
        market = vm.envBytes32("TG_LIVE_MARKET");
        gauge = vm.envAddress("TG_LIVE_GAUGE");
        token = vm.envAddress("TG_LIVE_TOKEN");
        stock = vm.envAddress("TG_LIVE_STOCK");
        bob = vm.envAddress("TG_LIVE_BOB");
        dave = vm.envAddress("TG_LIVE_DAVE");
        holder = vm.envAddress("TG_LIVE_HOLDER");
        distributor = ILiveHolder(vm.envAddress("TG_LIVE_DISTRIBUTOR"));
        require(address(vault).code.length > 0 && gauge.code.length > 0, "deployed code required");
    }

    function mature() private {
        vm.warp(block.timestamp + 2 days);
    }

    function solvent() private view {
        assertGe(address(vault).balance, vault.totalLiability(address(0)), "Quote solvency");
        assertGe(IERC20(token).balanceOf(address(vault)), vault.totalLiability(token), "Meme solvency");
    }

    function test_PublicStateLockedClaimAndWithdrawalReject() public {
        PositionView memory p = ILiveGauge(gauge).positionOf(bob);
        assertGt(p.unlockAt, block.timestamp);
        vm.startPrank(bob);
        vm.expectRevert();
        vault.claimUserRewardAssets(market, 1, 0, 1, false, false, 0);
        vm.expectRevert();
        allocation.unstakeAndWithdraw(market);
        vm.stopPrank();
        solvent();
    }

    function test_MatureSingleAssetClaimsPreserveOtherUserAndAsset() public {
        mature();
        PositionView memory before = ILiveGauge(gauge).positionOf(bob);
        PositionView memory other = ILiveGauge(gauge).positionOf(dave);
        assertGt(before.quoteClaimable, 0);
        assertGt(before.memeClaimable, 0);
        vm.prank(bob);
        (uint256 q, uint256 m,) = vault.claimUserRewardAssets(market, 1, 0, 1, false, false, 0);
        assertEq(q, before.quoteClaimable);
        assertEq(m, 0);
        assertEq(ILiveGauge(gauge).positionOf(bob).memeClaimable, before.memeClaimable);
        vm.prank(bob);
        (q, m,) = vault.claimUserRewardAssets(market, 1, 0, 2, false, false, 0);
        assertEq(q, 0);
        assertEq(m, before.memeClaimable);
        assertEq(ILiveGauge(gauge).positionOf(dave).memeClaimable, other.memeClaimable);
        assertEq(ILiveGauge(gauge).positionOf(dave).quoteClaimable, other.quoteClaimable);
        solvent();
    }

    function test_MatureConversionUsesActualPool() public {
        mature();
        PositionView memory before = ILiveGauge(gauge).positionOf(bob);
        assertGt(before.memeClaimable, 0);
        vm.prank(bob);
        (uint256 q, uint256 m, uint256 retained) =
            vault.claimUserRewardAssets(market, 1, 0, 2, true, false, block.timestamp + 240);
        assertGt(q, 0);
        assertEq(m, 0);
        assertEq(retained, 0);
        assertEq(ILiveGauge(gauge).positionOf(bob).quoteClaimable, before.quoteClaimable);
        solvent();
    }

    function test_ExpiredConversionRetainsMemeButPaysQuote() public {
        mature();
        PositionView memory before = ILiveGauge(gauge).positionOf(bob);
        assertGt(before.memeClaimable, 0);
        vm.prank(bob);
        (uint256 q, uint256 m, uint256 retained) =
            vault.claimUserRewardAssets(market, 1, 0, 3, true, false, block.timestamp - 1);
        assertEq(q, before.quoteClaimable);
        assertEq(m, 0);
        assertEq(retained, before.memeClaimable);
        assertEq(ILiveGauge(gauge).positionOf(bob).memeClaimable, retained);
        solvent();
    }

    function test_ExpiredConversionAuthorizedRawFallback() public {
        mature();
        PositionView memory before = ILiveGauge(gauge).positionOf(bob);
        assertGt(before.memeClaimable, 0);
        vm.prank(bob);
        (uint256 q, uint256 m, uint256 retained) =
            vault.claimUserRewardAssets(market, 1, 0, 3, true, true, block.timestamp - 1);
        assertEq(q, before.quoteClaimable);
        assertEq(m, before.memeClaimable);
        assertEq(retained, 0);
        solvent();
    }

    function test_MaturePrincipalWithdrawsExactly() public {
        mature();
        PositionView memory p = ILiveGauge(gauge).positionOf(bob);
        uint256 before = IERC20(stock).balanceOf(bob);
        vm.prank(bob);
        allocation.unstakeAndWithdraw(market);
        assertEq(IERC20(stock).balanceOf(bob) - before, p.activeAmount + p.pendingAmount);
        assertEq(ILiveGauge(gauge).positionOf(bob).activeAmount, 0);
        solvent();
    }

    function test_FaultingQuoteReceiverCanStillClaimMeme() public {
        mature();
        PositionView memory p = ILiveGauge(gauge).positionOf(bob);
        assertGt(p.memeClaimable, 0);
        vm.etch(bob, hex"60006000fd");
        vm.prank(bob);
        vm.expectRevert();
        vault.claimUserRewardAssets(market, 1, 0, 3, false, false, 0);
        vm.prank(bob);
        (uint256 q, uint256 m,) = vault.claimUserRewardAssets(market, 1, 0, 2, false, false, 0);
        assertEq(q, 0);
        assertEq(m, p.memeClaimable);
        assertEq(ILiveGauge(gauge).positionOf(bob).quoteClaimable, p.quoteClaimable);
        solvent();
    }

    function test_FaultingMemeReadCanStillClaimQuote() public {
        mature();
        PositionView memory p = ILiveGauge(gauge).positionOf(bob);
        assertGt(p.quoteClaimable, 0);
        vm.mockCallRevert(token, abi.encodeWithSelector(IERC20.balanceOf.selector, address(vault)), hex"deadbeef");
        vm.prank(bob);
        vm.expectRevert();
        vault.claimUserRewardAssets(market, 1, 0, 3, false, false, 0);
        vm.prank(bob);
        (uint256 q, uint256 m,) = vault.claimUserRewardAssets(market, 1, 0, 1, false, false, 0);
        assertEq(q, p.quoteClaimable);
        assertEq(m, 0);
        assertEq(ILiveGauge(gauge).positionOf(bob).memeClaimable, p.memeClaimable);
        vm.clearMockedCalls();
        solvent();
    }

    function test_EarlyRageQuitReturnsPrincipal() public {
        PositionView memory p = ILiveGauge(gauge).positionOf(bob);
        uint256 before = IERC20(stock).balanceOf(bob);
        vm.prank(bob);
        allocation.rageQuit(market);
        assertEq(IERC20(stock).balanceOf(bob) - before, p.activeAmount + p.pendingAmount);
        solvent();
    }

    function test_HolderMatureDualAssetClaimAndNoDoubleClaim() public {
        mature();
        (uint256 wantQ, uint256 wantM) = distributor.claimableAssets(market, holder);
        assertGt(wantQ, 0);
        assertGt(wantM, 0);
        vm.prank(holder);
        (uint256 q, uint256 m,) = vault.claimUserRewardAssets(market, 2, 0, 1, false, false, 0);
        assertEq(q, wantQ);
        assertEq(m, 0);
        (, uint256 stillM) = distributor.claimableAssets(market, holder);
        assertEq(stillM, wantM);
        vm.prank(holder);
        (q, m,) = vault.claimUserRewardAssets(market, 2, 0, 2, false, false, 0);
        assertEq(q, 0);
        assertEq(m, wantM);
        vm.prank(holder);
        (q, m,) = vault.claimUserRewardAssets(market, 2, 0, 3, false, false, 0);
        assertEq(q + m, 0);
        solvent();
    }

    function test_HolderConversionUsesOwnedRights() public {
        mature();
        (uint256 wantQ, uint256 wantM) = distributor.claimableAssets(market, holder);
        assertGt(wantM, 0);
        vm.prank(holder);
        (uint256 q, uint256 m, uint256 retained) =
            vault.claimUserRewardAssets(market, 2, 0, 2, true, false, block.timestamp + 240);
        assertGt(q, 0);
        assertEq(m + retained, 0);
        (uint256 stillQ,) = distributor.claimableAssets(market, holder);
        assertEq(stillQ, wantQ);
        solvent();
    }
}
