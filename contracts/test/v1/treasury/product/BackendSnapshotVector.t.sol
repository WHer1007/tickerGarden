// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;
import {Test} from "forge-std/Test.sol";
import {AccessManager} from "@openzeppelin/contracts/access/manager/AccessManager.sol";
import {HolderRewardsDistributorV1 as Rewards} from "../../../../src/v1/modules/HolderRewardsDistributorV1.sol";
import {TickerMemeTokenV1} from "../../../../src/v1/modules/TickerMemeTokenV1.sol";
import {MarketView} from "../../../../src/v1/interfaces/IV1Protocol.sol";
import {SnapshotRegistry, SnapshotAuthority, SnapshotVault, SnapshotHook} from "./HolderSnapshotRewards.t.sol";

// Root/proofs produced by the backend vector in services/backend-ts/tests/fixtures.
// This tests ABI/Merkle interoperability, not the historical balance evidence pipeline.
contract BackendSnapshotVectorTest is Test {
    bytes32 constant ID = bytes32(uint256(2));

    function testBackendOddTreePublishesAndAllWalletsClaim() public {
        vm.chainId(31337);
        vm.roll(1000);
        AccessManager authority = new AccessManager(address(this));
        SnapshotRegistry registry = new SnapshotRegistry(address(new SnapshotAuthority(address(authority))));
        Rewards implementation = new Rewards(address(registry));
        vm.etch(address(0x1111), address(implementation).code);
        Rewards rewards = Rewards(address(0x1111));
        SnapshotVault vault = new SnapshotVault();
        TickerMemeTokenV1 token =
            new TickerMemeTokenV1(ID, address(this), address(0xC001), address(rewards), "Test", "T", "", 6);
        MarketView memory market;
        market.config.memeToken = address(token);
        market.config.curve = address(0xC001);
        market.config.creatorFeesToHolders = true;
        market.config.graduatedHook = address(new SnapshotHook(address(vault)));
        registry.set(ID, market);
        rewards.registerFeeSharingMarket(ID, address(vault), address(0xC002));
        vm.deal(address(vault), 101);
        vm.prank(address(vault));
        rewards.fundQuoteRewards{value: 101}(ID, 1, 101);
        rewards.setSnapshotPublisher(address(this));
        vm.roll(2000);
        Rewards.Publication[] memory publications = new Rewards.Publication[](1);
        publications[0] = Rewards.Publication(
            ID,
            1,
            1000,
            bytes32(uint256(3)),
            0xeee5b88cd7c79d10e6df446994e357bccfcab596618f1a504a508e7792568fcf,
            0xa6d4d1698d9ec5690b23b2a56105388d90582dc740dcd8f410fc3b57d3256f5c,
            99,
            0
        );
        rewards.publishSnapshots(publications);
        bytes32[] memory proof;
        proof = new bytes32[](2);
        proof[0] = 0xe13187cbfe6902f702a10e9aa9208cef20bb0a562e03ff866463775bca6d8373;
        proof[1] = 0xc9ee5afa42e05521f7b16848f24bde581193d83168251d1cdce53ce733df8013;
        vm.prank(address(161));
        rewards.claimSnapshot(ID, 1, 16, 0, 1, proof);
        assertEq(address(161).balance, 16);
        proof = new bytes32[](2);
        proof[0] = 0x3154b23488971f70c3b97945819420d22e58477dfc8926331641f41119738688;
        proof[1] = 0xc9ee5afa42e05521f7b16848f24bde581193d83168251d1cdce53ce733df8013;
        vm.prank(address(162));
        rewards.claimSnapshot(ID, 1, 33, 0, 1, proof);
        assertEq(address(162).balance, 33);
        proof = new bytes32[](1);
        proof[0] = 0x4e9e869fea791d6d9afafd577eb286f7f16bec60a75f6d4c06b0ec791bb0ef03;
        vm.prank(address(163));
        rewards.claimSnapshot(ID, 1, 50, 0, 1, proof);
        assertEq(address(163).balance, 50);
        assertEq(rewards.roundState(ID, 1).quoteRemaining, 0);
        assertEq(rewards.marketState(ID).unallocatedQuote, 2);
    }
}
