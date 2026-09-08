// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {
    AssetView,
    PositionView,
    IOfficialStockRegistryV1,
    IProtocolFeeVault
} from "../../../src/v1/interfaces/IV1Protocol.sol";
import {MemeStockGauge} from "../../../src/v1/modules/MemeStockGauge.sol";

/// @notice Fork-only checks against the already deployed R3 scenario state.
contract V1DeployedR3TimeGatesTest is Test {
    string private manifest;
    string private scenarios;
    address private admin;
    address private staker;
    address private registry;
    address private feeVault;

    function setUp() public {
        assertEq(block.chainid, 421614, "R3 fork chain");
        manifest = vm.readFile(
            "../deployments/releases/0xe451138ea1858fdd816e0c1f4a0480945b16d85713056d33655a91bfb74eeeb7/arbitrum-sepolia-421614.v1.deployed.json"
        );
        scenarios = vm.readFile("../outputs/reviews/arbitrum-r3-scenarios/results.json");
        assertEq(vm.parseJsonUint(manifest, ".chainId"), 421614, "manifest chain");
        assertEq(
            vm.parseJsonBytes32(manifest, ".releaseId"),
            vm.parseJsonBytes32(scenarios, ".releaseId"),
            "scenario release mismatch"
        );
        string memory roles = vm.readFile("../outputs/reviews/arbitrum-r3-scenarios/roles.json");
        admin = vm.parseJsonAddress(roles, ".roles.admin");
        staker = vm.parseJsonAddress(roles, ".roles.staker");
        registry = vm.parseJsonAddress(manifest, ".ordinaryComponents[1]");
        feeVault = vm.parseJsonAddress(manifest, ".ordinaryComponents[15]");
    }

    function test_deployedActiveStakerQuoteClaimUnlockGate() public {
        bytes32 marketId = vm.parseJsonBytes32(scenarios, ".markets.active.id");
        address gauge = vm.parseJsonAddress(scenarios, ".markets.active.gauge");
        MemeStockGauge g = MemeStockGauge(gauge);
        PositionView memory before = g.positionOf(staker);
        assertGt(before.unlockAt, 0, "active position unlock timestamp");
        assertGt(before.quoteClaimable, 0, "converted quote must be claimable");
        // Normalize the fork clock to the real position's pre-unlock boundary.
        vm.warp(before.unlockAt - 1);

        vm.prank(staker);
        vm.expectRevert(abi.encodeWithSignature("PositionLockedUntil(uint64)", before.unlockAt));
        IProtocolFeeVault(feeVault).claimStaker(marketId, address(0));

        vm.warp(before.unlockAt);
        uint256 balanceBefore = staker.balance;
        vm.prank(staker);
        uint256 claimed = IProtocolFeeVault(feeVault).claimStaker(marketId, address(0));
        assertGt(claimed, 0, "claim amount");
        assertEq(staker.balance - balanceBefore, claimed, "recipient quote balance delta");
        assertEq(g.positionOf(staker).quoteClaimable, 0, "quote claimable cleared");
        uint256 balanceAfter = staker.balance;
        vm.prank(staker);
        uint256 repeated = IProtocolFeeVault(feeVault).claimStaker(marketId, address(0));
        assertEq(repeated, 0, "repeat claim amount");
        assertEq(staker.balance, balanceAfter, "repeat claim does not increase balance");
    }

    function test_deployedPausedAssetUnpauseDelayAndIdentity() public {
        bytes32 assetUid = vm.parseJsonBytes32(scenarios, ".markets.sharing.params.assetUid");
        AssetView memory paused = IOfficialStockRegistryV1(registry).asset(assetUid);
        assertEq(paused.status, 2, "sharing asset paused");
        address originalToken = paused.stockToken;
        vm.prank(admin);
        vm.expectRevert();
        IOfficialStockRegistryV1(registry).unpauseAsset(assetUid);
        vm.warp(block.timestamp + 1 days);
        vm.prank(admin);
        IOfficialStockRegistryV1(registry).unpauseAsset(assetUid);
        AssetView memory active = IOfficialStockRegistryV1(registry).asset(assetUid);
        assertEq(active.status, 1, "asset unpaused");
        assertEq(active.stockToken, originalToken, "asset identity unchanged");
        assertTrue(IOfficialStockRegistryV1(registry).assetIdentityCurrent(assetUid));
    }
}
