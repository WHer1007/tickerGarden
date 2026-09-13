// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {AccessManager} from "@openzeppelin/contracts/access/manager/AccessManager.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {ERC1967Utils} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Utils.sol";
import {HolderPoolFlowTest} from "../shared/HolderPoolFlow.t.sol";
import {HolderSnapshotRewardsTest} from "../treasury/product/HolderSnapshotRewards.t.sol";
import {HolderRewardsDistributorV1 as Rewards} from "../../../src/v1/modules/HolderRewardsDistributorV1.sol";
import {ApprovedQuoteRegistry} from "../../../src/v1/modules/ApprovedQuoteRegistry.sol";
import {OfficialStockRegistryV1} from "../../../src/v1/modules/OfficialStockRegistryV1.sol";
import {MemeStockGauge} from "../../../src/v1/modules/MemeStockGauge.sol";
import {MemeStockGaugeClone} from "../../../src/v1/shared/MemeStockGaugeClone.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {PoolSwapTest} from "@uniswap/v4-core/src/test/PoolSwapTest.sol";
import {MarketView, QuoteAssetConfig, GaugeIdentity} from "../../../src/v1/interfaces/IV1Protocol.sol";

contract CapacityAllocationMock {
    uint256 public active = 1 ether;
    uint256 public quoteAccumulator;
    uint256 public memeAccumulator;

    function setActive(uint256 amount) external {
        active = amount;
    }

    function rewardEligibleActiveStock(bytes32) external view returns (uint256) {
        return active;
    }

    function rewardCohortEpoch(bytes32) external pure returns (uint256) {
        return 0;
    }

    function recordGaugeRewardState(bytes32, uint256 q, uint256 m) external {
        quoteAccumulator = q;
        memeAccumulator = m;
    }
}

contract AuditFaultGauge {
    bool public fail = true;
    uint256 public credited;
    uint8 public mode;

    function setMode(uint8 value) external {
        mode = value;
    }

    function setFail(bool value) external {
        fail = value;
    }

    function effectiveTotalActiveStock() external view returns (uint256) {
        require(mode != 1, "WEIGHT_FAILURE");
        return 1 ether;
    }

    function creditStakerFee(address, uint256 amount, bytes32) external returns (uint256, uint256) {
        if (mode == 2) {
            assembly { invalid() }
        }
        if (mode == 3) {
            assembly { revert(0, 131072) }
        }
        require(!fail, "INJECTED_GAUGE_FAILURE");
        credited += amount;
        require(mode != 4, "LATE_FAILURE");
        return (amount, 0);
    }
}

/// Fault injection verifies blast radius, not an attacker-controlled way to alter production Registry/Gauge.
contract CurrentTradingBoundaryAuditTest is HolderPoolFlowTest {
    function testAudit_gaugeFailureAbandonsOnlyNewRewardsAndTradingContinues() public {
        AuditFaultGauge gauge = new AuditFaultGauge();
        MarketView memory value = registry.market(ID);
        value.config.stakingEnabled = true;
        value.config.gauge = address(gauge);
        registry.set(value, registry.canonicalPoolKey(ID));
        uint256 beforeBalance = meme.balanceOf(ALICE);
        _sell();
        assertLt(meme.balanceOf(ALICE), beforeBalance);
        assertEq(gauge.credited(), 0);
        assertEq(vault.liability(ID, address(quote), 1), 0);
        assertGt(vault.forfeitureReserve(ID, address(quote)), 0);
        vm.prank(ALICE);
        meme.transfer(address(0xB0B), 1 ether);
        assertEq(meme.balanceOf(address(0xB0B)), 1 ether);
        gauge.setFail(false);
        _sell();
        assertGt(gauge.credited(), 0);
    }

    function testAudit_realGaugeThirtyMatureBucketsFitBudgetWithoutLosingRewards() public {
        CapacityAllocationMock allocation = new CapacityAllocationMock();
        MemeStockGauge implementation = new MemeStockGauge();
        MemeStockGauge gauge = MemeStockGauge(
            MemeStockGaugeClone.deployDeterministic(
                address(implementation),
                keccak256("capacity"),
                GaugeIdentity(
                    ID,
                    bytes32(uint256(1)),
                    bytes32(uint256(2)),
                    address(allocation),
                    address(vault),
                    address(quote),
                    address(meme)
                )
            )
        );
        MarketView memory value = registry.market(ID);
        value.config.stakingEnabled = true;
        value.config.gauge = address(gauge);
        registry.set(value, registry.canonicalPoolKey(ID));
        vm.prank(address(allocation));
        gauge.addPending(address(0x8000), 1 ether, uint64(block.timestamp + 30), uint64(block.timestamp + 1 days));
        vm.warp(block.timestamp + 30);
        _sell();
        // A real buy seeds the second asset accumulator; both remain nonzero for every new snapshot.
        quote.mint(ALICE, 1 ether);
        vm.prank(ALICE);
        quote.approve(address(router), type(uint256).max);
        bool direction = Currency.unwrap(key.currency0) == address(quote);
        vm.prank(ALICE);
        router.swap(
            key,
            SwapParams(
                direction, -int256(0.0001 ether), direction ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1
            ),
            PoolSwapTest.TestSettings(false, false),
            ""
        );
        assertGt(allocation.quoteAccumulator(), 0);
        assertGt(allocation.memeAccumulator(), 0);
        uint256 origin = block.timestamp;
        for (uint256 i; i < 30; ++i) {
            vm.warp(origin + i);
            vm.prank(address(allocation));
            gauge.addPending(
                address(uint160(0x9000 + i)), 1 ether, uint64(block.timestamp + 30), uint64(block.timestamp + 1 days)
            );
        }
        vm.warp(origin + 59);
        allocation.setActive(31 ether);
        vm.cool(address(gauge));
        vm.cool(address(implementation));
        vm.cool(address(allocation));
        vm.cool(address(vault));
        vm.cool(address(manager));
        vm.cool(address(registry));
        uint256 beforeGas = gasleft();
        _sell();
        emit log_named_uint("real-gauge-30-bucket-full-swap-gas", beforeGas - gasleft());
        assertEq(gauge.totalPendingStock(), 0);
        assertEq(gauge.storedTotalActiveStock(), 31 ether);
        assertEq(vault.forfeitureReserve(ID, address(quote)), 0);
        assertEq(vault.forfeitureReserve(ID, address(meme)), 0);
    }

    function testAudit_weightGasBombReturndataAndLateFailureDoNotBlockSwap() public {
        AuditFaultGauge gauge = new AuditFaultGauge();
        gauge.setFail(false);
        MarketView memory value = registry.market(ID);
        value.config.stakingEnabled = true;
        value.config.gauge = address(gauge);
        registry.set(value, registry.canonicalPoolKey(ID));
        for (uint8 mode = 1; mode <= 4; ++mode) {
            gauge.setMode(mode);
            uint256 reserve = vault.forfeitureReserve(ID, address(quote));
            _sell();
            assertGt(vault.forfeitureReserve(ID, address(quote)), reserve);
            assertEq(gauge.credited(), 0); // Even a late mutation rolls back inside the self-call.
        }
        gauge.setMode(0);
        _sell();
        assertGt(gauge.credited(), 0);
        assertEq(vault.liability(ID, address(quote), 1), gauge.credited());
    }

    function auditSell() external {
        _sell();
    }

    function testAudit_underfundedGasCannotSkipHealthyRewards() public {
        AuditFaultGauge gauge = new AuditFaultGauge();
        gauge.setFail(false);
        MarketView memory value = registry.market(ID);
        value.config.stakingEnabled = true;
        value.config.gauge = address(gauge);
        registry.set(value, registry.canonicalPoolKey(ID));
        (bool ok,) = address(this).call{gas: 1_000_000}(abi.encodeCall(this.auditSell, ()));
        assertFalse(ok);
        assertEq(vault.forfeitureReserve(ID, address(quote)), 0);
        assertEq(gauge.credited(), 0);
        vm.expectRevert();
        vault.settleV4StakerFee(address(gauge), address(quote), 1, bytes32(uint256(1)));
    }

    function testAudit_deficitCoverCreatesNoRightsAndRejectsOverpayment() public {
        _sell();
        uint256 liability = vault.totalLiability(address(quote));
        deal(address(quote), address(vault), liability - 10);
        quote.mint(address(this), 11);
        quote.approve(address(vault), 11);
        vm.expectRevert();
        vault.coverAssetDeficit(address(quote), 11);
        vault.coverAssetDeficit(address(quote), 4);
        (,, uint256 deficit) = vault.assetCoverage(address(quote));
        assertEq(deficit, 6);
        assertEq(vault.totalLiability(address(quote)), liability);
        vault.coverAssetDeficit(address(quote), 6);
        (,, deficit) = vault.assetCoverage(address(quote));
        assertEq(deficit, 0);
        assertEq(vault.totalLiability(address(quote)), liability);
        vm.expectRevert();
        vault.coverAssetDeficit(address(quote), 1);
        _sell();
    }

    function testAudit_feeVaultAssetDeficitBlocksSwapAndClaimUntilRestored() public {
        _sell();
        uint256 liability = vault.totalLiability(address(quote));
        assertGt(liability, 0);
        deal(address(quote), address(vault), liability - 1); // Inject external asset loss, not a public exploit.
        vm.expectRevert();
        _sell();
        vm.expectRevert();
        vault.claimPlatform(ID, address(quote));
        vm.prank(ALICE);
        meme.transfer(address(0xB0B), 1 ether);
        quote.mint(address(vault), 1); // Restore coverage without changing fee ownership.
        _sell();
        vault.claimPlatform(ID, address(quote));
        assertEq(quote.balanceOf(address(vault)), vault.totalLiability(address(quote)));
    }
}

contract CurrentPublisherBoundaryAuditTest is HolderSnapshotRewardsTest {
    function testAudit_trustedPublisherCanAllocateToWalletWithNoMeme() public {
        assertEq(token.balanceOf(BOB), 0);
        _fund(2 ether, 0);
        _publish(_publication(r.claimLeaf(ID, 1, BOB, 2 ether, 0), 2 ether, 0));
        uint256 beforeBalance = BOB.balance;
        _claim(BOB, 2 ether, 0, 1);
        assertEq(BOB.balance - beforeBalance, 2 ether);
        assertEq(token.balanceOf(BOB), 0);
    }

    function testAudit_accessManagerClosureDoesNotStopPublisher() public {
        _fund(1 ether, 0);
        r.setSnapshotPublisher(PUBLISHER);
        manager.setTargetClosed(address(r), true);
        vm.roll(2000);
        Rewards.Publication[] memory ps = new Rewards.Publication[](1);
        ps[0] = _publication(r.claimLeaf(ID, 1, ALICE, 1 ether, 0), 1 ether, 0);
        vm.prank(PUBLISHER);
        r.publishSnapshots(ps);
        _claim(ALICE, 1 ether, 0, 1);
    }

    function testAudit_guardianRevocationStopsNewRootsButPreservesClaims() public {
        _fund(2 ether, 0);
        _publish(_publication(r.claimLeaf(ID, 1, ALICE, 1 ether, 0), 1 ether, 0));
        manager.grantRole(2, BOB, 0);
        vm.expectRevert(Rewards.Unauthorized.selector);
        vm.prank(PUBLISHER);
        r.revokeSnapshotPublisher(PUBLISHER);
        manager.setTargetClosed(address(r), true);
        vm.prank(BOB);
        r.revokeSnapshotPublisher(PUBLISHER);
        assertEq(r.snapshotPublisher(), address(0));
        Rewards.Publication[] memory ps = new Rewards.Publication[](1);
        ps[0] = _publication(r.claimLeaf(ID, 2, ALICE, 1 ether, 0), 1 ether, 0);
        ps[0].round = 2;
        ps[0].snapshotBlock = 1001;
        vm.expectRevert(Rewards.Unauthorized.selector);
        vm.prank(PUBLISHER);
        r.publishSnapshots(ps);
        _claim(ALICE, 1 ether, 0, 1);
        manager.setTargetClosed(address(r), false);
        r.setSnapshotPublisher(ALICE);
        vm.expectRevert(Rewards.InvalidPublisher.selector);
        vm.prank(BOB); // Stale revoke cannot remove replacement.
        r.revokeSnapshotPublisher(PUBLISHER);
        assertEq(r.snapshotPublisher(), ALICE);
    }

    function testAudit_leafMatchesOfflinePreflightVector() public {
        vm.chainId(4663);
        vm.etch(address(0x1234), address(r).code);
        assertEq(
            Rewards(address(0x1234)).claimLeaf(bytes32(uint256(4)), 1, address(1), 33, 16),
            0x5d928456ddf8e9fec94a65e0576a07ddeb03b66f6689594b2ffec4344e0484fc
        );
    }

    function testAudit_holderMemePaymentReusesBalanceAndKeepsFinalCheck() public {
        _fund(0, 2 ether);
        _publish(_publication(r.claimLeaf(ID, 1, ALICE, 0, 2 ether), 0, 2 ether));
        vm.expectCall(address(token), abi.encodeWithSignature("balanceOf(address)", address(r)), uint64(4));
        _claim(ALICE, 0, 2 ether, 2);
    }

    function testAudit_zeroPublisherCannotBeUsedForEmergencyRevocation() public {
        r.setSnapshotPublisher(PUBLISHER);
        vm.expectRevert(Rewards.InvalidPublisher.selector);
        r.setSnapshotPublisher(address(0));
        assertEq(r.snapshotPublisher(), PUBLISHER);
    }
}

/// Only used to demonstrate that generic Quote proxy shell identity does not pin its implementation.
contract AuditUpgradeableQuoteV1 {
    address private immutable admin = msg.sender;
    function initialize() external {}

    function decimals() external pure returns (uint8) {
        return 18;
    }

    function behavior() external pure virtual returns (uint256) {
        return 1;
    }

    function upgradeTo(address implementation) external {
        require(msg.sender == admin, "ADMIN_ONLY");
        ERC1967Utils.upgradeToAndCall(implementation, "");
    }
}

contract AuditUpgradeableQuoteV2 is AuditUpgradeableQuoteV1 {
    function behavior() external pure override returns (uint256) {
        return 2;
    }
}

contract CurrentGenericQuoteBoundaryAuditTest is Test {
    function testAudit_genericProxyUpgradeStillPassesIdentityCheck() public {
        AccessManager manager = new AccessManager(address(this));
        OfficialStockRegistryV1 stocks = new OfficialStockRegistryV1(address(manager));
        ApprovedQuoteRegistry quotes = new ApprovedQuoteRegistry(address(manager), address(stocks));
        address proxy = address(
            new ERC1967Proxy(
                address(new AuditUpgradeableQuoteV1()), abi.encodeCall(AuditUpgradeableQuoteV1.initialize, ())
            )
        );
        QuoteAssetConfig memory config;
        config.tickerGardenBaselineId = keccak256("audit-baseline");
        config.quoteAsset = proxy;
        config.quoteDecimals = 18;
        config.phantomQuote = 1 ether;
        config.graduationThreshold = 2 ether;
        config.status = 1;
        config.economicsHash = keccak256(
            abi.encode(
                keccak256("TICKERGARDEN_V1_QUOTE_ECONOMICS"),
                uint256(1),
                block.chainid,
                config.tickerGardenBaselineId,
                proxy,
                uint8(18),
                uint256(1 ether),
                uint256(2 ether)
            )
        );
        quotes.addQuoteConfig(config.economicsHash, config);
        assertTrue(quotes.quoteIdentityCurrent(config.economicsHash));
        bytes32 shellHash = proxy.codehash;
        AuditUpgradeableQuoteV1(proxy).upgradeTo(address(new AuditUpgradeableQuoteV2()));
        assertEq(AuditUpgradeableQuoteV1(proxy).behavior(), 2);
        assertEq(proxy.codehash, shellHash);
        assertTrue(quotes.quoteIdentityCurrent(config.economicsHash));
    }
}
