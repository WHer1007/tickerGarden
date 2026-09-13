// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;
import {
    HolderRewardsDistributorV1 as CurrentHolderRewards
} from "../../../../src/v1/modules/HolderRewardsDistributorV1.sol";

import {AccessManager} from "@openzeppelin/contracts/access/manager/AccessManager.sol";
import {HolderAccountingHarness as HolderRewardsDistributorV1} from "../../mocks/HolderAccountingHarness.sol";
import {HolderRewardsDistributorV1Test} from "./HolderRewardsDistributorV1.t.sol";

contract HolderIntervalAuthoritySource {
    address public immutable authority;

    constructor(address value) {
        authority = value;
    }
}

contract HolderFundingIntervalTest is HolderRewardsDistributorV1Test {
    AccessManager manager;

    function setUp() public override {
        super.setUp();
        manager = new AccessManager(address(this));
        registry.setStockRegistry(address(new HolderIntervalAuthoritySource(address(manager))));
    }

    function test_intervalAuthorizationBoundsAndDelayedExecution() public {
        assertEq(d.fundingInterval(ID), 4 hours);
        vm.prank(ALICE);
        vm.expectRevert(CurrentHolderRewards.Unauthorized.selector);
        d.setFundingInterval(ID, 1 hours);
        vm.expectRevert(CurrentHolderRewards.InvalidFundingInterval.selector);
        d.setFundingInterval(ID, 3599);
        vm.expectRevert(CurrentHolderRewards.InvalidFundingInterval.selector);
        d.setFundingInterval(ID, 24 hours + 1);
        vm.expectRevert(CurrentHolderRewards.InvalidMarket.selector);
        d.setFundingInterval(bytes32(uint256(123)), 1 hours);
        bytes4[] memory selectors = new bytes4[](1);
        selectors[0] = d.setFundingInterval.selector;
        manager.setTargetFunctionRole(address(d), selectors, 42);
        manager.grantRole(42, ALICE, 2 days);
        bytes memory data = abi.encodeCall(d.setFundingInterval, (ID, 1 hours));
        vm.prank(ALICE);
        manager.schedule(address(d), data, 0);
        vm.prank(ALICE);
        vm.expectRevert(CurrentHolderRewards.Unauthorized.selector);
        d.setFundingInterval(ID, 1 hours);
        vm.warp(block.timestamp + 2 days);
        vm.prank(ALICE);
        manager.execute(address(d), data);
        assertEq(d.fundingInterval(ID), 1 hours);
    }

    function test_shorterIntervalPreservesExistingStreamAndEarnings() public {
        _send(CURVE, ALICE, 100 ether);
        _fund(24 ether);
        uint256 start = block.timestamp;
        vm.warp(start + 1 hours);
        _fund(24 ether);
        (,, uint64 end, uint256 count) = d.releaseState(ID);
        assertEq(count, 1);
        uint256 earned = d.claimable(ID, ALICE);
        d.setFundingInterval(ID, 1 hours);
        assertEq(d.claimable(ID, ALICE), earned);
        d.checkpoint(ID);
        (uint256 unreleased, uint256 idle, uint64 firstEnd, uint256 active) = d.releaseState(ID);
        assertEq(firstEnd, end);
        assertEq(active, 2);
        assertEq(idle, 0);
        assertApproxEqAbs(unreleased, 47 ether, 1);
        vm.warp(start + 25 hours);
        assertEq(_claim(ALICE), 48 ether);
        assertEq(d.totalLiability(address(0)), 0);
    }

    function test_longerIntervalQueuesWithoutExtendingExistingRewards() public {
        _send(CURVE, ALICE, 100 ether);
        _fund(24 ether);
        uint256 start = block.timestamp;
        vm.warp(start + 1 hours);
        d.setFundingInterval(ID, 24 hours);
        _fund(24 ether);
        vm.warp(start + 24 hours - 1);
        d.checkpoint(ID);
        (, uint256 idle, uint64 end, uint256 active) = d.releaseState(ID);
        assertEq(idle, 24 ether);
        assertEq(end, start + 24 hours);
        assertEq(active, 1);
        vm.warp(start + 24 hours);
        assertEq(_claim(ALICE), 24 ether);
        vm.warp(start + 48 hours);
        assertEq(_claim(ALICE), 24 ether);
    }

    function testFuzz_intervalChangesRemainBoundedAndConserve(uint256 seed) public {
        _send(CURVE, ALICE, 100 ether);
        for (uint256 i; i < 72; ++i) {
            seed = uint256(keccak256(abi.encode(seed, i)));
            d.setFundingInterval(ID, 1 hours + seed % (23 hours + 1));
            _fund(1 ether);
            assertLe(d.marketState(ID).count, 24);
            vm.warp(block.timestamp + 1 hours);
        }
        vm.warp(block.timestamp + 24 hours);
        d.checkpoint(ID);
        vm.warp(block.timestamp + 24 hours);
        assertApproxEqAbs(_claim(ALICE), 72 ether, 1);
    }

    function test_hourlyFundingWrapsRingWithoutBlockingTransfers() public {
        _send(CURVE, ALICE, 100 ether);
        d.setFundingInterval(ID, 1 hours);
        for (uint256 i; i < 72; ++i) {
            _fund(24 ether);
            if (i >= 23) assertEq(d.marketState(ID).count, 24);
            _send(ALICE, BOB, 1 ether);
            _send(BOB, ALICE, 1 ether);
            vm.warp(block.timestamp + 1 hours);
        }
        vm.warp(block.timestamp + 24 hours);
        assertEq(_claim(ALICE), 72 * 24 ether);
        assertEq(d.totalLiability(address(0)), 0);
    }

    function test_twentyFourExpiredBatchesHaveBoundedTransferWork() public {
        _send(CURVE, ALICE, 100 ether);
        d.setFundingInterval(ID, 1 hours);
        for (uint256 i; i < 24; ++i) {
            _fund(1 ether);
            vm.warp(block.timestamp + 1 hours);
        }
        vm.warp(block.timestamp + 24 hours);
        uint256 beforeGas = gasleft();
        _send(ALICE, BOB, 1 ether);
        assertLt(beforeGas - gasleft(), 800_000);
        assertEq(d.marketState(ID).count, 0);
        assertEq(d.claimable(ID, BOB), 0);
        assertEq(_claim(ALICE), 24 ether);
    }
}
