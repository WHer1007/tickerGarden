// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {Errors} from "@openzeppelin/contracts/utils/Errors.sol";

import {
    ActivationSlot,
    ActivationSnapshot,
    GaugeIdentity,
    IMemeStockGauge,
    PositionView,
    RewardStateView
} from "../../../src/v2/interfaces/IV2Protocol.sol";
import {MemeStockGauge} from "../../../src/v2/modules/MemeStockGauge.sol";
import {MemeStockGaugeAccumulators} from "../../../src/v2/shared/MemeStockGaugeAccumulators.sol";
import {MemeStockGaugeClone} from "../../../src/v2/shared/MemeStockGaugeClone.sol";
import {MemeStockGaugeLockedPositions} from "../../../src/v2/shared/MemeStockGaugeLockedPositions.sol";

contract MockGaugeToken {}

contract MockGaugeController {
    bool public allocationOpen = true;

    function setAllocationOpen(bool value) external {
        allocationOpen = value;
    }

    function isStockAllocationOpen(bytes32) external view returns (bool) {
        return allocationOpen;
    }

    function disable(MemeStockGauge gauge, uint32 recoveryEpoch, uint64 snapshotBlock, bytes32 stateHash) external {
        gauge.disableForEmergency(recoveryEpoch, snapshotBlock, stateHash);
    }
}

contract MockGaugeModuleCaller {
    function add(MemeStockGauge gauge, address user, uint256 amount, uint64 activationAt, uint64 unlockAt) external {
        gauge.addPending(user, amount, activationAt, unlockAt);
    }

    function remove(MemeStockGauge gauge, address user) external returns (uint256) {
        return gauge.removeAllocation(user);
    }

    function settle(MemeStockGauge gauge, address user) external {
        gauge.settle(user);
    }

    function credit(MemeStockGauge gauge, address feeAsset, uint256 amount, bytes32 feeId)
        external
        returns (uint256, uint256)
    {
        return gauge.creditStakerFee(feeAsset, amount, feeId);
    }

    function consume(MemeStockGauge gauge, address user, address feeAsset) external returns (uint256) {
        return gauge.consumeClaimable(user, feeAsset);
    }
}

contract MemeStockGaugeTest is Test {
    uint256 internal constant P = 1e27;
    bytes32 internal constant MARKET_ID = keccak256("gauge-market");
    bytes32 internal constant ASSET_UID = keccak256("stock-asset");
    bytes32 internal constant QUOTE_CONFIG_ID = keccak256("quote-config");
    bytes32 internal constant STATE_HASH = keccak256("emergency-state");
    address internal constant ALICE = address(0xA11CE);
    address internal constant BOB = address(0xB0B);

    MockGaugeModuleCaller internal manager;
    MockGaugeModuleCaller internal feeVault;
    MockGaugeController internal controller;
    MockGaugeToken internal quote;
    MockGaugeToken internal meme;
    MemeStockGauge internal gaugeImplementation;
    MemeStockGauge internal gauge;

    function setUp() public {
        manager = new MockGaugeModuleCaller();
        feeVault = new MockGaugeModuleCaller();
        controller = new MockGaugeController();
        quote = new MockGaugeToken();
        meme = new MockGaugeToken();
        gaugeImplementation = new MemeStockGauge();
        gauge = _deploy(address(quote), address(meme));
        vm.warp(1_000_000);
        vm.roll(100);
    }

    function test_cloneCreatesEmptyImmutableRewardDomainWithoutInitializer() public {
        assertEq(address(gauge).code.length, 301);
        assertEq(gauge.storedTotalActiveStock(), 0);
        assertEq(gauge.effectiveTotalActiveStock(), 0);
        assertEq(gauge.totalPendingStock(), 0);
        _assertRewardState(address(quote), 0, 0);
        _assertRewardState(address(meme), 0, 0);

        (bool initialized,) = address(gauge).call(abi.encodeWithSignature("initialize(bytes)"));
        assertFalse(initialized);

        GaugeIdentity memory identity = gauge.gaugeIdentity();
        assertEq(identity.marketId, MARKET_ID);
        assertEq(identity.assetUid, ASSET_UID);
        assertEq(identity.quoteAssetConfigId, QUOTE_CONFIG_ID);
        assertEq(identity.allocationManager, address(manager));
        assertEq(identity.protocolFeeVault, address(feeVault));
        assertEq(identity.marketController, address(controller));
        assertEq(identity.quoteAsset, address(quote));
        assertEq(identity.memeToken, address(meme));
    }

    function test_cloneDeploymentRejectsInvalidIdentityAssetsAndAliasedDependencies() public {
        GaugeIdentity memory init = _validInit(address(quote), address(meme));
        init.marketId = bytes32(0);
        vm.expectRevert(
            abi.encodeWithSelector(
                MemeStockGaugeClone.InvalidGaugeIdentity.selector,
                init.marketId,
                init.assetUid,
                init.quoteAssetConfigId,
                init.quoteAsset,
                init.memeToken
            )
        );
        this.deployGaugeCloneForTest(bytes32("BAD_MARKET"), init);

        init = _validInit(address(quote), address(meme));
        init.quoteAsset = address(0xBAD);
        vm.expectRevert(
            abi.encodeWithSelector(
                MemeStockGaugeClone.InvalidGaugeIdentity.selector,
                init.marketId,
                init.assetUid,
                init.quoteAssetConfigId,
                init.quoteAsset,
                init.memeToken
            )
        );
        this.deployGaugeCloneForTest(bytes32("BAD_QUOTE"), init);

        init = _validInit(address(quote), address(meme));
        init.protocolFeeVault = address(manager);
        vm.expectRevert(
            abi.encodeWithSelector(
                MemeStockGaugeClone.InvalidGaugeDependencies.selector,
                init.allocationManager,
                init.protocolFeeVault,
                init.marketController
            )
        );
        this.deployGaugeCloneForTest(bytes32("BAD_DEPS"), init);
    }

    function test_implementationAndMalformedCloneCannotActAsGauge() public {
        vm.expectRevert(
            abi.encodeWithSelector(
                MemeStockGaugeClone.InvalidGaugeCloneRuntime.selector,
                address(gaugeImplementation),
                address(gaugeImplementation).code.length,
                301
            )
        );
        gaugeImplementation.storedTotalActiveStock();

        address malformed = Clones.cloneWithImmutableArgs(address(gaugeImplementation), hex"1234");
        vm.expectRevert(
            abi.encodeWithSelector(
                MemeStockGaugeClone.InvalidGaugeCloneRuntime.selector, malformed, malformed.code.length, 301
            )
        );
        MemeStockGauge(malformed).gaugeIdentity();
    }

    function test_cloneIdentityAndStorageAreIsolatedAcrossMarkets() public {
        GaugeIdentity memory secondIdentity = _validInit(address(quote), address(meme));
        secondIdentity.marketId = keccak256("second-market");
        secondIdentity.assetUid = keccak256("second-stock");
        secondIdentity.quoteAssetConfigId = keccak256("second-quote");
        MemeStockGauge second = MemeStockGauge(
            MemeStockGaugeClone.deployDeterministic(
                address(gaugeImplementation), bytes32("SECOND_GAUGE"), secondIdentity
            )
        );

        _schedule(ALICE, 100);
        assertEq(gauge.totalPendingStock(), 100);
        assertEq(second.totalPendingStock(), 0);
        assertEq(second.gaugeIdentity().marketId, secondIdentity.marketId);
        assertNotEq(gauge.gaugeIdentity().marketId, second.gaugeIdentity().marketId);

        uint64 snapshotBlock = uint64(block.number - 1);
        controller.disable(gauge, 1, snapshotBlock, STATE_HASH);
        (uint64 generation, uint64 unlockAt) = _times();
        manager.add(second, BOB, 50, generation, unlockAt);
        assertEq(second.totalPendingStock(), 50);
        assertEq(gauge.totalPendingStock(), 100);
        vm.expectRevert(
            abi.encodeWithSelector(MemeStockGauge.GaugeEmergencyDisabled.selector, 1, snapshotBlock, STATE_HASH)
        );
        gauge.checkpointActivations();
    }

    function test_duplicateCloneSaltRevertsWithoutNonceFallback() public {
        GaugeIdentity memory identity = _validInit(address(quote), address(meme));
        bytes32 salt = keccak256(abi.encode(address(quote), address(meme)));
        vm.expectRevert(Errors.FailedDeployment.selector);
        this.deployGaugeCloneForTest(salt, identity);
    }

    function test_nativeQuoteIsSupportedButCannotAliasMeme() public {
        MemeStockGauge nativeGauge = _deploy(address(0), address(meme));
        _assertRewardStateFor(nativeGauge, address(0), 0, 0);

        GaugeIdentity memory init = _validInit(address(meme), address(meme));
        vm.expectRevert(
            abi.encodeWithSelector(
                MemeStockGaugeClone.InvalidGaugeIdentity.selector,
                init.marketId,
                init.assetUid,
                init.quoteAssetConfigId,
                init.quoteAsset,
                init.memeToken
            )
        );
        this.deployGaugeCloneForTest(bytes32("ALIASED_ASSETS"), init);
    }

    function test_allMutationCallersAreFixedAndCannotBeBypassed() public {
        (uint64 generation, uint64 unlockAt) = _times();
        vm.expectRevert(
            abi.encodeWithSelector(
                MemeStockGauge.UnauthorizedAllocationModule.selector, address(this), address(manager)
            )
        );
        gauge.addPending(ALICE, 1, generation, unlockAt);
        vm.expectRevert(
            abi.encodeWithSelector(
                MemeStockGauge.UnauthorizedAllocationModule.selector, address(this), address(manager)
            )
        );
        gauge.removeAllocation(ALICE);
        vm.expectRevert(abi.encodeWithSelector(MemeStockGauge.UnauthorizedSettlementCaller.selector, address(this)));
        gauge.settle(ALICE);
        vm.expectRevert(
            abi.encodeWithSelector(MemeStockGauge.UnauthorizedFeeVault.selector, address(this), address(feeVault))
        );
        gauge.creditStakerFee(address(quote), 0, bytes32(0));
        vm.expectRevert(
            abi.encodeWithSelector(MemeStockGauge.UnauthorizedFeeVault.selector, address(this), address(feeVault))
        );
        gauge.consumeClaimable(ALICE, address(quote));
        vm.expectRevert(
            abi.encodeWithSelector(
                MemeStockGauge.UnauthorizedMarketController.selector, address(this), address(controller)
            )
        );
        gauge.disableForEmergency(1, uint64(block.number - 1), STATE_HASH);
    }

    function test_marketLifecycleGateRejectsNewAllocationAndRollsBackSchedule() public {
        controller.setAllocationOpen(false);
        (uint64 generation, uint64 unlockAt) = _times();
        vm.expectRevert(abi.encodeWithSelector(MemeStockGauge.StockAllocationClosed.selector, MARKET_ID));
        manager.add(gauge, ALICE, 100, generation, unlockAt);

        PositionView memory position = gauge.positionOf(ALICE);
        assertEq(position.pendingAmount, 0);
        assertEq(gauge.totalPendingStock(), 0);
        assertEq(gauge.activationSlot(uint8(generation % 32)).generation, 0);
    }

    function test_addPendingUsesCanonicalTimesAndViewsProjectMatureWeight() public {
        (uint64 generation, uint64 unlockAt) = _schedule(ALICE, 100);
        PositionView memory position = gauge.positionOf(ALICE);
        assertEq(position.pendingAmount, 100);
        assertEq(position.pendingGeneration, generation);
        assertEq(position.unlockAt, unlockAt);
        assertEq(gauge.totalPendingStock(), 100);

        vm.warp(generation);
        assertEq(gauge.storedTotalActiveStock(), 0);
        assertEq(gauge.effectiveTotalActiveStock(), 100);
    }

    function test_activationBoundaryIsExactAt29_30And31Seconds() public {
        uint256 scheduledAt = block.timestamp;
        (uint64 generation,) = _schedule(ALICE, 100);

        vm.warp(scheduledAt + 29 seconds);
        PositionView memory at29 = gauge.positionOf(ALICE);
        assertEq(at29.activeAmount, 0);
        assertEq(at29.pendingAmount, 100);
        assertEq(gauge.storedTotalActiveStock(), 0);
        assertEq(gauge.effectiveTotalActiveStock(), 0);

        vm.warp(scheduledAt + 30 seconds);
        assertEq(block.timestamp, generation);
        assertEq(gauge.effectiveTotalActiveStock(), 100);
        gauge.checkpointActivations();
        assertEq(gauge.storedTotalActiveStock(), 100);
        assertEq(gauge.totalPendingStock(), 0);
        assertEq(gauge.positionOf(ALICE).pendingAmount, 100);

        vm.warp(scheduledAt + 31 seconds);
        feeVault.settle(gauge, ALICE);
        PositionView memory at31 = gauge.positionOf(ALICE);
        assertEq(at31.activeAmount, 100);
        assertEq(at31.pendingAmount, 0);
        assertEq(gauge.storedTotalActiveStock(), 100);
    }

    function test_exactActivationBoundaryParticipatesInCurrentFeeWithoutHistoricalBackfill() public {
        (uint64 generation,) = _schedule(ALICE, 100);
        vm.warp(generation);

        (uint256 delta, uint256 remainder) = feeVault.credit(gauge, address(quote), 100, keccak256("quote-boundary"));
        assertEq(delta, P);
        assertEq(remainder, 0);

        ActivationSnapshot memory snapshot = gauge.activationSnapshot(generation);
        assertTrue(snapshot.processed);
        assertEq(snapshot.quoteAccumulator, 0);
        assertEq(gauge.positionOf(ALICE).quoteClaimable, 100);

        feeVault.settle(gauge, ALICE);
        PositionView memory position = gauge.positionOf(ALICE);
        assertEq(position.activeAmount, 100);
        assertEq(position.pendingAmount, 0);
        assertEq(position.quoteClaimable, 100);
        assertFalse(gauge.activationSnapshot(generation).processed);
    }

    function test_beforeActivationPendingCannotEarnAndNonzeroCreditHasNoActiveWeight() public {
        (uint64 generation,) = _schedule(ALICE, 100);
        vm.warp(generation - 1);

        vm.expectRevert(abi.encodeWithSelector(MemeStockGaugeAccumulators.StakerCreditWithoutActiveStock.selector, 1));
        feeVault.credit(gauge, address(quote), 1, keccak256("too-early"));
        assertEq(gauge.positionOf(ALICE).quoteClaimable, 0);
        assertEq(gauge.totalPendingStock(), 100);
    }

    function test_activeAndPendingUseDistinctIndicesForBothAssets() public {
        (uint64 firstGeneration,) = _schedule(ALICE, 100);
        vm.warp(firstGeneration);
        feeVault.credit(gauge, address(quote), 100, keccak256("q1"));
        feeVault.credit(gauge, address(meme), 200, keccak256("m1"));
        feeVault.settle(gauge, ALICE);

        vm.warp(block.timestamp + 1);
        (uint64 secondGeneration,) = _schedule(ALICE, 50);
        feeVault.credit(gauge, address(quote), 100, keccak256("q2"));
        feeVault.credit(gauge, address(meme), 200, keccak256("m2"));
        vm.warp(secondGeneration);
        feeVault.credit(gauge, address(quote), 300, keccak256("q3"));
        feeVault.credit(gauge, address(meme), 600, keccak256("m3"));

        feeVault.settle(gauge, ALICE);
        PositionView memory position = gauge.positionOf(ALICE);
        assertEq(position.activeAmount, 150);
        assertEq(position.pendingAmount, 0);
        assertEq(position.quoteClaimable, 500);
        assertEq(position.memeClaimable, 1_000);
    }

    function test_consumingOneAssetSettlesBothButOnlyClearsSelectedClaimable() public {
        (uint64 generation, uint64 unlockAt) = _schedule(ALICE, 100);
        vm.warp(generation);
        feeVault.credit(gauge, address(quote), 100, keccak256("q"));
        feeVault.credit(gauge, address(meme), 200, keccak256("m"));

        // Claiming is subject to the same 24-hour lock as normal removal.
        vm.warp(unlockAt);
        assertEq(feeVault.consume(gauge, ALICE, address(quote)), 100);
        PositionView memory position = gauge.positionOf(ALICE);
        assertEq(position.quoteClaimable, 0);
        assertEq(position.memeClaimable, 200);
        assertEq(feeVault.consume(gauge, ALICE, address(quote)), 0);
        assertEq(feeVault.consume(gauge, ALICE, address(meme)), 200);
    }

    function test_claimBeforeUnlockRevertsForBothRewardAssetsAndPreservesClaimable() public {
        (uint64 generation, uint64 unlockAt) = _schedule(ALICE, 100);
        vm.warp(generation);
        feeVault.credit(gauge, address(quote), 100, keccak256("locked-q"));
        feeVault.credit(gauge, address(meme), 200, keccak256("locked-m"));
        vm.warp(unlockAt - 1);

        bytes memory lockedError =
            abi.encodeWithSelector(MemeStockGaugeLockedPositions.PositionLockedUntil.selector, unlockAt);
        vm.expectRevert(lockedError);
        feeVault.consume(gauge, ALICE, address(quote));
        vm.expectRevert(lockedError);
        feeVault.consume(gauge, ALICE, address(meme));

        PositionView memory position = gauge.positionOf(ALICE);
        assertEq(position.quoteClaimable, 100);
        assertEq(position.memeClaimable, 200);
    }

    function test_fullRemovalSettlesOldWeightAndClearsLock() public {
        (uint64 generation, uint64 unlockAt) = _schedule(ALICE, 100);
        vm.warp(generation);
        feeVault.settle(gauge, ALICE);
        feeVault.credit(gauge, address(quote), 100, keccak256("before-remove"));
        vm.warp(unlockAt);

        assertEq(manager.remove(gauge, ALICE), 100);

        PositionView memory position = gauge.positionOf(ALICE);
        assertEq(position.activeAmount, 0);
        assertEq(position.unlockAt, 0);
        assertEq(position.quoteClaimable, 100);
        assertEq(gauge.storedTotalActiveStock(), 0);
    }

    function test_fullClosePreservesFractionAndReallocationCanCompleteIt() public {
        (uint64 generation, uint64 unlockAt) = _schedule(ALICE, 2);
        _schedule(BOB, 1);
        vm.warp(generation);
        feeVault.credit(gauge, address(quote), 1, keccak256("fraction-1"));
        feeVault.settle(gauge, ALICE);
        vm.warp(unlockAt);
        assertEq(manager.remove(gauge, ALICE), 2);
        PositionView memory closed = gauge.positionOf(ALICE);
        assertEq(closed.activeAmount, 0);
        assertEq(closed.unlockAt, 0);
        assertEq(closed.quoteClaimable, 0);

        vm.warp(block.timestamp + 1);
        (uint64 nextGeneration,) = _schedule(ALICE, 2);
        vm.warp(nextGeneration);
        feeVault.credit(gauge, address(quote), 2, keccak256("fraction-2"));
        feeVault.settle(gauge, ALICE);

        assertGt(gauge.positionOf(ALICE).quoteClaimable, 0);
    }

    function test_multipleUsersReceiveExactActiveWeightProportions() public {
        (uint64 generation,) = _schedule(ALICE, 1);
        _schedule(BOB, 3);
        vm.warp(generation);
        feeVault.credit(gauge, address(quote), 40, keccak256("proportions"));

        feeVault.settle(gauge, ALICE);
        feeVault.settle(gauge, BOB);
        assertEq(gauge.positionOf(ALICE).quoteClaimable, 10);
        assertEq(gauge.positionOf(BOB).quoteClaimable, 30);
        assertFalse(gauge.activationSnapshot(generation).processed);
    }

    function test_unsupportedAssetCannotChangeEitherRewardDomain() public {
        (uint64 generation,) = _schedule(ALICE, 1);
        vm.warp(generation);
        address unsupported = address(new MockGaugeToken());

        vm.expectRevert(abi.encodeWithSelector(MemeStockGauge.UnsupportedRewardAsset.selector, unsupported));
        feeVault.credit(gauge, unsupported, 1, keccak256("bad-asset"));

        assertEq(gauge.storedTotalActiveStock(), 0);
        _assertRewardState(address(quote), 0, 0);
        _assertRewardState(address(meme), 0, 0);
    }

    function test_sharedSnapshotReferenceDeletesOnlyAfterBothUsersSettle() public {
        (uint64 generation,) = _schedule(ALICE, 1);
        _schedule(BOB, 1);
        vm.warp(generation);
        gauge.checkpointActivations();

        feeVault.settle(gauge, ALICE);
        assertEq(gauge.activationSnapshot(generation).refs, 1);
        feeVault.settle(gauge, BOB);
        assertFalse(gauge.activationSnapshot(generation).processed);
    }

    function test_lockBoundaryAndWholeRemovalRemainEnforcedByConcreteGauge() public {
        (uint64 generation, uint64 unlockAt) = _schedule(ALICE, 10);
        vm.warp(generation);
        feeVault.settle(gauge, ALICE);
        vm.warp(unlockAt - 1);
        vm.expectRevert(abi.encodeWithSelector(MemeStockGaugeLockedPositions.PositionLockedUntil.selector, unlockAt));
        manager.remove(gauge, ALICE);
        vm.warp(unlockAt);
        assertEq(manager.remove(gauge, ALICE), 10);
        assertEq(gauge.positionOf(ALICE).activeAmount, 0);
    }

    function test_emergencyDisableIsOneWayAndFreezesEveryMutationPath() public {
        (uint64 generation,) = _schedule(ALICE, 10);
        uint64 snapshotBlock = uint64(block.number - 1);
        controller.disable(gauge, 7, snapshotBlock, STATE_HASH);

        bytes memory disabledError =
            abi.encodeWithSelector(MemeStockGauge.GaugeEmergencyDisabled.selector, 7, snapshotBlock, STATE_HASH);
        vm.expectRevert(disabledError);
        gauge.checkpointActivations();
        vm.expectRevert(disabledError);
        manager.settle(gauge, ALICE);
        vm.expectRevert(disabledError);
        feeVault.credit(gauge, address(quote), 0, bytes32(0));
        vm.expectRevert(disabledError);
        feeVault.consume(gauge, ALICE, address(quote));
        vm.expectRevert(disabledError);
        manager.add(gauge, ALICE, 1, generation, uint64(block.timestamp + 24 hours));
        vm.expectRevert(disabledError);
        manager.remove(gauge, ALICE);

        vm.expectRevert(
            abi.encodeWithSelector(MemeStockGauge.GaugeAlreadyEmergencyDisabled.selector, 7, snapshotBlock, STATE_HASH)
        );
        controller.disable(gauge, 8, snapshotBlock, keccak256("replacement"));
        assertEq(gauge.totalPendingStock(), 10);
    }

    function test_emergencyRequiresCurrentPreTransitionBlockAndNonzeroDomain() public {
        vm.expectRevert(
            abi.encodeWithSelector(
                MemeStockGauge.InvalidEmergencySnapshot.selector, 0, uint64(block.number - 1), STATE_HASH
            )
        );
        controller.disable(gauge, 0, uint64(block.number - 1), STATE_HASH);
        vm.expectRevert(
            abi.encodeWithSelector(
                MemeStockGauge.InvalidEmergencySnapshot.selector, 1, uint64(block.number), STATE_HASH
            )
        );
        controller.disable(gauge, 1, uint64(block.number), STATE_HASH);
        vm.expectRevert(
            abi.encodeWithSelector(
                MemeStockGauge.InvalidEmergencySnapshot.selector, 1, uint64(block.number - 1), bytes32(0)
            )
        );
        controller.disable(gauge, 1, uint64(block.number - 1), bytes32(0));
    }

    function test_canonicalSelectorsMatchInterface() public pure {
        assertEq(MemeStockGauge.gaugeIdentity.selector, IMemeStockGauge.gaugeIdentity.selector);
        assertEq(MemeStockGauge.addPending.selector, IMemeStockGauge.addPending.selector);
        assertEq(MemeStockGauge.removeAllocation.selector, IMemeStockGauge.removeAllocation.selector);
        assertEq(MemeStockGauge.checkpointActivations.selector, IMemeStockGauge.checkpointActivations.selector);
        assertEq(MemeStockGauge.settle.selector, IMemeStockGauge.settle.selector);
        assertEq(MemeStockGauge.creditStakerFee.selector, IMemeStockGauge.creditStakerFee.selector);
        assertEq(MemeStockGauge.consumeClaimable.selector, IMemeStockGauge.consumeClaimable.selector);
        assertEq(MemeStockGauge.disableForEmergency.selector, IMemeStockGauge.disableForEmergency.selector);
    }

    function deployGaugeCloneForTest(bytes32 salt, GaugeIdentity calldata identity) external returns (address) {
        return MemeStockGaugeClone.deployDeterministic(address(gaugeImplementation), salt, identity);
    }

    function _schedule(address user, uint256 amount) private returns (uint64 generation, uint64 unlockAt) {
        (generation, unlockAt) = _times();
        manager.add(gauge, user, amount, generation, unlockAt);
    }

    function _times() private view returns (uint64 generation, uint64 unlockAt) {
        generation = uint64(block.timestamp + 30 seconds);
        unlockAt = uint64(block.timestamp + 24 hours);
    }

    function _deploy(address quoteAsset, address memeToken) private returns (MemeStockGauge) {
        GaugeIdentity memory identity = _validInit(quoteAsset, memeToken);
        return MemeStockGauge(
            MemeStockGaugeClone.deployDeterministic(
                address(gaugeImplementation), keccak256(abi.encode(quoteAsset, memeToken)), identity
            )
        );
    }

    function _validInit(address quoteAsset, address memeToken) private view returns (GaugeIdentity memory init) {
        init = GaugeIdentity({
            marketId: MARKET_ID,
            assetUid: ASSET_UID,
            quoteAssetConfigId: QUOTE_CONFIG_ID,
            allocationManager: address(manager),
            protocolFeeVault: address(feeVault),
            marketController: address(controller),
            quoteAsset: quoteAsset,
            memeToken: memeToken
        });
    }

    function _assertRewardState(address feeAsset, uint256 accumulator, uint256 remainder) private view {
        _assertRewardStateFor(gauge, feeAsset, accumulator, remainder);
    }

    function _assertRewardStateFor(
        MemeStockGauge target,
        address feeAsset,
        uint256 expectedAccumulator,
        uint256 expectedRemainder
    ) private view {
        RewardStateView memory state = target.rewardState(feeAsset);
        assertEq(state.accFeePerShare, expectedAccumulator);
        assertEq(state.indexRemainder, expectedRemainder);
    }
}
