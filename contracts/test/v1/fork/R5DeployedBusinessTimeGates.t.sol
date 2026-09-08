// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;
import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ProtocolFeeVault} from "../../../src/v1/modules/ProtocolFeeVault.sol";
import {AllocationManager} from "../../../src/v1/modules/AllocationManager.sol";
import {MemeStockGauge} from "../../../src/v1/modules/MemeStockGauge.sol";
import {OfficialStockRegistryV1} from "../../../src/v1/modules/OfficialStockRegistryV1.sol";
import {TreasuryDistributorV1} from "../../../src/v1/modules/TreasuryDistributorV1.sol";
import {PositionView} from "../../../src/v1/interfaces/IV1Protocol.sol";

/// @notice Local time-warp tests on the actual R5 deployed graph and this run's mined positions.
/// @dev These tests do not prove that natural public-chain deadlines have elapsed.
contract R5DeployedBusinessTimeGatesTest is Test {
    string f;
    ProtocolFeeVault fees;
    AllocationManager manager;
    OfficialStockRegistryV1 stocks;
    TreasuryDistributorV1 distributor;
    address staker;
    address creator;
    address admin;

    function setUp() public {
        assertEq(block.chainid, 421614, "fork chain");
        f = vm.readFile("../outputs/reviews/r5-business-acceptance-2026-09-06/time-fixture.json");
        assertEq(
            vm.parseJsonBytes32(f, ".releaseId"),
            0x14963af9576a3b1cb915b8a13e86e0899a4c8345c010c47d4932789ebf46031d,
            "R5 binding"
        );
        fees = ProtocolFeeVault(payable(vm.parseJsonAddress(f, ".fees")));
        manager = AllocationManager(vm.parseJsonAddress(f, ".manager"));
        stocks = OfficialStockRegistryV1(vm.parseJsonAddress(f, ".stocks"));
        distributor = TreasuryDistributorV1(payable(vm.parseJsonAddress(f, ".distributor")));
        staker = vm.parseJsonAddress(f, ".roles.staker");
        creator = vm.parseJsonAddress(f, ".roles.creator");
        admin = vm.parseJsonAddress(f, ".roles.admin");
        assertEq(address(fees).codehash, vm.parseJsonBytes32(f, ".feeVaultRuntimeCodeHash"), "actual R5 FeeVault code");
    }

    function test_R5ActualPositionNormalExitAtBoundaryPreservesQuoteAndPrincipal() public {
        bytes32 id = vm.parseJsonBytes32(f, ".staking.id");
        MemeStockGauge gauge = MemeStockGauge(vm.parseJsonAddress(f, ".staking.gauge"));
        PositionView memory pos = gauge.positionOf(staker);
        assertEq(pos.activeAmount + pos.pendingAmount, 100 ether);
        address quote = vm.parseJsonAddress(f, ".staking.quote");
        IERC20 stock = IERC20(vm.parseJsonAddress(f, ".stock"));
        uint256 principalBefore = stock.balanceOf(staker);
        uint256 quoteBefore = IERC20(quote).balanceOf(staker);
        vm.warp(pos.unlockAt - 1);
        vm.prank(staker);
        vm.expectRevert(abi.encodeWithSignature("PositionLockedUntil(uint64)", pos.unlockAt));
        manager.unstakeAndWithdraw(id);
        vm.warp(pos.unlockAt);
        vm.prank(staker);
        manager.unstakeAndWithdraw(id);
        assertEq(stock.balanceOf(staker) - principalBefore, 100 ether, "exact wallet principal");
        vm.prank(staker);
        uint256 amount = fees.claimStaker(id, quote);
        assertGt(amount, 0, "converted quote retained");
        assertEq(IERC20(quote).balanceOf(staker) - quoteBefore, amount);
        vm.warp(pos.unlockAt + 1);
        vm.prank(staker);
        assertEq(fees.claimStaker(id, quote), 0, "repeat claim");
    }

    function test_R5ActualCreatorRawRewardSevenDayBoundary() public {
        bytes32 id = vm.parseJsonBytes32(f, ".raw.marketId");
        address meme = vm.parseJsonAddress(f, ".raw.token");
        uint256 due = fees.rawRewardExitAt(id, creator);
        assertGt(due, 0);
        uint256 expected = fees.creatorLiability(id, 1, meme);
        assertGt(expected, 0);
        vm.warp(due - 1);
        vm.expectRevert(abi.encodeWithSignature("OriginalRewardExitNotReady(uint256)", due));
        fees.claimCreator(id, 1, meme);
        uint256 before = IERC20(meme).balanceOf(creator);
        vm.warp(due);
        assertEq(fees.claimCreator(id, 1, meme), expected);
        assertEq(IERC20(meme).balanceOf(creator) - before, expected);
        vm.warp(due + 1);
        assertEq(fees.claimCreator(id, 1, meme), 0);
    }

    function test_R5ActualPausedStockUnpauseDelay() public {
        bytes32 uid = vm.parseJsonBytes32(f, ".stockUid");
        uint64 due = uint64(vm.parseJsonUint(f, ".unpauseAt"));
        assertEq(stocks.asset(uid).status, 2);
        vm.warp(due - 1);
        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSignature("UnpauseStateDelayNotElapsed(bytes32,uint64)", uid, due));
        stocks.unpauseAsset(uid);
        vm.warp(due);
        vm.prank(admin);
        stocks.unpauseAsset(uid);
        assertEq(stocks.asset(uid).status, 1);
        assertTrue(stocks.assetIdentityCurrent(uid));
    }

    function test_R5ActualHolderEpochRequestBoundary() public {
        bytes32 id = vm.parseJsonBytes32(f, ".holder.id");
        (, uint64 end) = distributor.epochWindow(id, 1);
        uint64 ready = end + distributor.finalityDelaySeconds();
        address buyer = vm.parseJsonAddress(f, ".roles.buyer");
        uint256 serviceFee = distributor.rootServiceFee().amount;
        vm.deal(buyer, 1 ether);
        vm.warp(end - 1);
        vm.prank(buyer);
        vm.expectRevert(abi.encodeWithSignature("EpochNotClosed(uint64)", ready));
        distributor.requestRoot{value: serviceFee}(id, 1);
        vm.warp(ready - 1);
        vm.prank(buyer);
        vm.expectRevert(abi.encodeWithSignature("EpochNotClosed(uint64)", ready));
        distributor.requestRoot{value: serviceFee}(id, 1);
        vm.warp(ready);
        vm.roll(block.number + 100);
        vm.setBlockhash(block.number - distributor.finalityDelayBlocks(), keccak256("R5_LOCAL_FINALITY_ONLY"));
        vm.prank(buyer);
        distributor.requestRoot{value: serviceFee}(id, 1);
    }
}
