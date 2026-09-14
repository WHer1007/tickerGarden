// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {HolderSnapshotRewardsTest} from "../treasury/product/HolderSnapshotRewards.t.sol";
import {HolderRewardsDistributorV1 as Rewards} from "../../../src/v1/modules/HolderRewardsDistributorV1.sol";

contract HolderBatchClockTest is HolderSnapshotRewardsTest {
    function test_publishBatchReadsCanonicalNumberOnce() public {
        vm.chainId(4663);
        vm.mockCall(address(100), abi.encodeWithSignature("arbBlockNumber()"), abi.encode(uint256(2000)));
        _fund(2 ether, 0);
        r.setSnapshotPublisher(PUBLISHER);

        Rewards.Publication[] memory ps = new Rewards.Publication[](2);
        ps[0] = _publication(keccak256("root 1"), 1 ether, 0);
        ps[1] = Rewards.Publication(
            ID, 2, 1001, keccak256("block 1001"), keccak256("root 2"), keccak256("public dataset 2"), 1 ether, 0
        );
        vm.expectCall(address(100), abi.encodeWithSignature("arbBlockNumber()"), 1);
        vm.prank(PUBLISHER);
        r.publishSnapshots(ps);
        assertEq(r.marketState(ID).lastRound, 2);
    }

    function test_publishBatchLateInvalidItemRollsBackEarlierItem() public {
        vm.chainId(4663);
        vm.mockCall(address(100), abi.encodeWithSignature("arbBlockNumber()"), abi.encode(uint256(2000)));
        _fund(2 ether, 0);
        r.setSnapshotPublisher(PUBLISHER);

        Rewards.Publication[] memory ps = new Rewards.Publication[](2);
        ps[0] = _publication(keccak256("root 1"), 1 ether, 0);
        ps[1] = Rewards.Publication(
            ID, 2, 1001, keccak256("block 1001"), bytes32(0), keccak256("public dataset 2"), 1 ether, 0
        );
        vm.prank(PUBLISHER);
        vm.expectRevert(Rewards.InvalidPublication.selector);
        r.publishSnapshots(ps);
        assertEq(r.marketState(ID).lastRound, 0);
        assertEq(r.marketState(ID).unallocatedQuote, 2 ether);
    }
}
