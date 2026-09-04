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
} from "../../../src/v1/interfaces/IV1Protocol.sol";
import {MemeStockGauge} from "../../../src/v1/modules/MemeStockGauge.sol";
import {MemeStockGaugeAccumulators} from "../../../src/v1/shared/MemeStockGaugeAccumulators.sol";
import {MemeStockGaugeClone} from "../../../src/v1/shared/MemeStockGaugeClone.sol";
import {MemeStockGaugeLockedPositions} from "../../../src/v1/shared/MemeStockGaugeLockedPositions.sol";

contract MockGaugeToken {}

contract MockGaugeModuleCaller {
    mapping(bytes32 marketId => mapping(address user => uint256 principal)) internal _rageQuitSettlementPrincipal;
    mapping(bytes32 marketId => MemeStockGauge) internal _gauges;
    mapping(bytes32 marketId => address[]) internal _users;
    mapping(bytes32 marketId => mapping(address user => bool known)) internal _knownUsers;
    mapping(bytes32 marketId => mapping(address user => bool snapshotted)) internal _hasRageQuitCutoff;
    mapping(bytes32 marketId => mapping(address user => uint256 quoteAccumulator)) internal _quoteCutoffs;
    mapping(bytes32 marketId => mapping(address user => uint256 memeAccumulator)) internal _memeCutoffs;
    mapping(bytes32 marketId => uint256 quoteAccumulator) internal _latestQuoteAccumulator;
    mapping(bytes32 marketId => uint256 memeAccumulator) internal _latestMemeAccumulator;
    mapping(bytes32 marketId => mapping(address user => uint256 activeAmount)) internal _active;
    mapping(bytes32 marketId => mapping(address user => uint256 pendingAmount)) internal _pending;
    mapping(bytes32 marketId => mapping(address user => uint64 activationAt)) internal _activationAt;
    mapping(bytes32 marketId => mapping(address user => bool rageQuiting)) internal _rageQuiting;
    mapping(bytes32 marketId => uint256 nonce) internal _cohortNonces;
    mapping(bytes32 marketId => mapping(address user => bool snapshotted)) internal _hasCohortSnapshot;
    mapping(bytes32 marketId => mapping(address user => uint256 amount)) internal _remainingAtExit;
    mapping(bytes32 marketId => mapping(address user => uint256 nonce)) internal _cohortNonceAtExit;

    function setRageQuitSettlementPrincipal(bytes32 marketId, address user, uint256 principal) external {
        _rageQuitSettlementPrincipal[marketId][user] = principal;
    }

    function rageQuitSettlementPending(bytes32 marketId, address user)
        external
        view
        returns (bool pending, uint256 principal)
    {
        principal = _rageQuitSettlementPrincipal[marketId][user];
        pending = principal != 0;
    }

    function add(MemeStockGauge gauge, address user, uint256 amount, uint64 activationAt, uint64 unlockAt) external {
        bytes32 marketId = gauge.gaugeIdentity().marketId;
        _gauges[marketId] = gauge;
        if (!_knownUsers[marketId][user]) {
            _knownUsers[marketId][user] = true;
            _users[marketId].push(user);
        }
        PositionView memory beforePosition = gauge.positionOf(user);
        _active[marketId][user] = beforePosition.activeAmount;
        _pending[marketId][user] = beforePosition.pendingAmount + amount;
        _activationAt[marketId][user] = activationAt;
        gauge.addPending(user, amount, activationAt, unlockAt);
        ++_cohortNonces[marketId];
    }

    function remove(MemeStockGauge gauge, address user) external returns (uint256) {
        bytes32 marketId = gauge.gaugeIdentity().marketId;
        uint256 amount = gauge.removeAllocation(user);
        delete _active[marketId][user];
        delete _pending[marketId][user];
        delete _activationAt[marketId][user];
        ++_cohortNonces[marketId];
        return amount;
    }

    function rageQuit(MemeStockGauge gauge, address user) external returns (uint256, uint256, uint256, bool) {
        bytes32 marketId = gauge.gaugeIdentity().marketId;
        if (!_hasRageQuitCutoff[marketId][user]) _snapshotRageQuitRewardCutoff(marketId, user);
        if (!_rageQuiting[marketId][user]) {
            _rageQuiting[marketId][user] = true;
            ++_cohortNonces[marketId];
            _snapshotCohort(marketId, user);
        }
        (uint256 principal, uint256 quoteForfeited, uint256 memeForfeited, bool redistributed) = gauge.rageQuit(user);
        delete _rageQuiting[marketId][user];
        delete _active[marketId][user];
        delete _pending[marketId][user];
        delete _activationAt[marketId][user];
        return (principal, quoteForfeited, memeForfeited, redistributed);
    }

    function snapshotRageQuitRewardCutoff(bytes32 marketId, address user) external {
        _snapshotRageQuitRewardCutoff(marketId, user);
    }

    function deferRageQuitRewardCleanup(bytes32 marketId, address user) external {
        _snapshotRageQuitRewardCutoff(marketId, user);
        _rageQuitSettlementPrincipal[marketId][user] = _active[marketId][user] + _pending[marketId][user];
        _rageQuiting[marketId][user] = true;
        ++_cohortNonces[marketId];
        _snapshotCohort(marketId, user);
    }

    function rageQuitRewardCutoff(bytes32 marketId, address user)
        external
        view
        returns (uint256 principal, uint256 quoteAccumulator, uint256 memeAccumulator, bool forfeitureRedistributable)
    {
        principal = _rageQuitSettlementPrincipal[marketId][user];
        if (principal == 0) principal = _active[marketId][user] + _pending[marketId][user];
        if (_hasRageQuitCutoff[marketId][user]) {
            forfeitureRedistributable = _hasCohortSnapshot[marketId][user] && _remainingAtExit[marketId][user] != 0
                && _cohortNonceAtExit[marketId][user] == _cohortNonces[marketId]
                && _remainingAtExit[marketId][user] == _rewardEligibleActiveStock(marketId);
            return (principal, _quoteCutoffs[marketId][user], _memeCutoffs[marketId][user], forfeitureRedistributable);
        }
        return (principal, _latestQuoteAccumulator[marketId], _latestMemeAccumulator[marketId], false);
    }

    function rewardEligibleActiveStock(bytes32 marketId) external view returns (uint256 total) {
        return _rewardEligibleActiveStock(marketId);
    }

    function _rewardEligibleActiveStock(bytes32 marketId) private view returns (uint256 total) {
        for (uint256 i; i < _users[marketId].length; ++i) {
            address user = _users[marketId][i];
            if (_rageQuiting[marketId][user]) continue;
            total += _active[marketId][user];
            if (_pending[marketId][user] != 0 && _activationAt[marketId][user] <= block.timestamp) {
                total += _pending[marketId][user];
            }
        }
    }

    function recordGaugeRewardState(bytes32 marketId, uint256 quoteAccumulator, uint256 memeAccumulator) external {
        _latestQuoteAccumulator[marketId] = quoteAccumulator;
        _latestMemeAccumulator[marketId] = memeAccumulator;
    }

    function _snapshotRageQuitRewardCutoff(bytes32 marketId, address user) private {
        _hasRageQuitCutoff[marketId][user] = true;
        _quoteCutoffs[marketId][user] = _latestQuoteAccumulator[marketId];
        _memeCutoffs[marketId][user] = _latestMemeAccumulator[marketId];
    }

    function _snapshotCohort(bytes32 marketId, address user) private {
        _hasCohortSnapshot[marketId][user] = true;
        _remainingAtExit[marketId][user] = _rewardEligibleActiveStock(marketId);
        _cohortNonceAtExit[marketId][user] = _cohortNonces[marketId];
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
    address internal constant ALICE = address(0xA11CE);
    address internal constant BOB = address(0xB0B);
    address internal constant CHARLIE = address(0xCA11E);

    MockGaugeModuleCaller internal manager;
    MockGaugeModuleCaller internal feeVault;
    MockGaugeToken internal quote;
    MockGaugeToken internal meme;
    MemeStockGauge internal gaugeImplementation;
    MemeStockGauge internal gauge;

    function setUp() public {
        manager = new MockGaugeModuleCaller();
        feeVault = new MockGaugeModuleCaller();
        quote = new MockGaugeToken();
        meme = new MockGaugeToken();
        gaugeImplementation = new MemeStockGauge();
        gauge = _deploy(address(quote), address(meme));
        vm.warp(1_000_000);
        vm.roll(100);
    }

    function test_cloneCreatesEmptyImmutableRewardDomainWithoutInitializer() public {
        assertEq(address(gauge).code.length, 269);
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
                MemeStockGaugeClone.InvalidGaugeDependencies.selector, init.allocationManager, init.protocolFeeVault
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
                269
            )
        );
        gaugeImplementation.storedTotalActiveStock();

        address malformed = Clones.cloneWithImmutableArgs(address(gaugeImplementation), hex"1234");
        vm.expectRevert(
            abi.encodeWithSelector(
                MemeStockGaugeClone.InvalidGaugeCloneRuntime.selector, malformed, malformed.code.length, 269
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

        (uint64 generation, uint64 unlockAt) = _times();
        manager.add(second, BOB, 50, generation, unlockAt);
        assertEq(second.totalPendingStock(), 50);
        assertEq(gauge.totalPendingStock(), 100);
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
    }

    function test_oldEmergencyDisableSelectorHasNoCallableSurface() public {
        (bool success,) = address(gauge)
            .call(
                abi.encodeWithSignature(
                    "disableForEmergency(uint32,uint64,bytes32)",
                    uint32(1),
                    uint64(block.number - 1),
                    bytes32(uint256(1))
                )
            );
        assertFalse(success);
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

    function test_pendingPrincipalEscapeBlocksSettlementAndClaimsUntilGaugeForfeiture() public {
        (uint64 generation, uint64 unlockAt) = _schedule(ALICE, 100);
        vm.warp(generation);
        feeVault.credit(gauge, address(quote), 100, keccak256("pending-escape"));
        manager.setRageQuitSettlementPrincipal(MARKET_ID, ALICE, 100);

        bytes memory pendingError =
            abi.encodeWithSelector(MemeStockGauge.RageQuitRewardSettlementPending.selector, ALICE, MARKET_ID, 100);
        vm.expectRevert(pendingError);
        manager.settle(gauge, ALICE);
        vm.warp(unlockAt);
        vm.expectRevert(pendingError);
        feeVault.consume(gauge, ALICE, address(quote));

        (uint256 principal, uint256 quoteForfeited,,) = manager.rageQuit(gauge, ALICE);
        assertEq(principal, 100);
        assertEq(quoteForfeited, 100);
        assertEq(gauge.positionOf(ALICE).quoteClaimable, 0);
    }

    function test_rageQuitRewardCleanupRemainsAlwaysAvailable() public {
        _schedule(ALICE, 100);

        (uint256 principal,,,) = manager.rageQuit(gauge, ALICE);
        assertEq(principal, 100);
        PositionView memory position = gauge.positionOf(ALICE);
        assertEq(position.activeAmount, 0);
        assertEq(position.pendingAmount, 0);
    }

    function test_rageQuitRedistributesOnlyWhenExitTimeCohortRemainsUnchanged() public {
        (uint64 generation,) = _schedule(ALICE, 100);
        _schedule(BOB, 100);
        vm.warp(generation);
        feeVault.credit(gauge, address(quote), 200, keccak256("stable-cohort"));

        (uint256 principal, uint256 quoteForfeited,, bool redistributed) = manager.rageQuit(gauge, ALICE);

        assertEq(principal, 100);
        assertEq(quoteForfeited, 100);
        assertTrue(redistributed);
        assertEq(gauge.positionOf(BOB).quoteClaimable, 200);
        (uint256 deferredQuote,) = gauge.deferredForfeiture();
        assertEq(deferredQuote, 0);
    }

    function test_laterEntrantCannotCaptureForfeitureWhenNoActiveStakerRemainedAtExit() public {
        (uint64 aliceGeneration,) = _schedule(ALICE, 100);
        vm.warp(aliceGeneration);
        feeVault.credit(gauge, address(quote), 100, keccak256("alice-only-before-exit"));
        manager.deferRageQuitRewardCleanup(MARKET_ID, ALICE);

        (uint64 bobGeneration,) = _schedule(BOB, 100);
        vm.warp(bobGeneration);
        gauge.checkpointActivations();
        (uint256 principal, uint256 quoteForfeited,, bool redistributed) = manager.rageQuit(gauge, ALICE);

        assertEq(principal, 100);
        assertEq(quoteForfeited, 100);
        assertFalse(redistributed);
        assertEq(gauge.positionOf(BOB).quoteClaimable, 0);
        (uint256 deferredQuote,) = gauge.deferredForfeiture();
        assertEq(deferredQuote, 100);
    }

    function test_changedCohortFailsClosedInsteadOfDilutingExitTimeSurvivor() public {
        (uint64 generation,) = _schedule(ALICE, 100);
        _schedule(BOB, 100);
        vm.warp(generation);
        feeVault.credit(gauge, address(quote), 200, keccak256("before-deferred-exit"));
        manager.deferRageQuitRewardCleanup(MARKET_ID, ALICE);

        (uint64 charlieGeneration,) = _schedule(CHARLIE, 100);
        vm.warp(charlieGeneration);
        gauge.checkpointActivations();
        (uint256 principal, uint256 quoteForfeited,, bool redistributed) = manager.rageQuit(gauge, ALICE);

        assertEq(principal, 100);
        assertEq(quoteForfeited, 100);
        assertFalse(redistributed);
        assertEq(gauge.positionOf(BOB).quoteClaimable, 100);
        assertEq(gauge.positionOf(CHARLIE).quoteClaimable, 0);
        (uint256 deferredQuote,) = gauge.deferredForfeiture();
        assertEq(deferredQuote, 100);
    }

    function test_pendingMaturityAloneCannotJoinTheSnapshottedExitCohort() public {
        (uint64 activeGeneration,) = _schedule(ALICE, 100);
        _schedule(BOB, 100);
        vm.warp(activeGeneration);
        feeVault.settle(gauge, ALICE);
        feeVault.settle(gauge, BOB);

        (uint64 charlieGeneration,) = _schedule(CHARLIE, 100);
        feeVault.credit(gauge, address(quote), 200, keccak256("before-pending-maturity"));
        manager.deferRageQuitRewardCleanup(MARKET_ID, ALICE);

        // No allocation mutation occurs after the exit snapshot. The independently frozen effective weight
        // still detects Charlie's later maturity and prevents the old forfeiture from flowing to that entrant.
        vm.warp(charlieGeneration);
        gauge.checkpointActivations();
        (uint256 principal, uint256 quoteForfeited,, bool redistributed) = manager.rageQuit(gauge, ALICE);

        assertEq(principal, 100);
        assertEq(quoteForfeited, 100);
        assertFalse(redistributed);
        assertEq(gauge.positionOf(BOB).quoteClaimable, 100);
        assertEq(gauge.positionOf(CHARLIE).quoteClaimable, 0);
        (uint256 deferredQuote,) = gauge.deferredForfeiture();
        assertEq(deferredQuote, 100);
    }

    function test_changedCohortReserveDoesNotAbsorbSurvivingGlobalRemainder() public {
        (uint64 generation,) = _schedule(ALICE, 2);
        _schedule(BOB, 1);
        vm.warp(generation);
        feeVault.credit(gauge, address(quote), 1, keccak256("fraction-before-deferred-exit"));
        assertEq(gauge.rewardState(address(quote)).indexRemainder, 1);
        manager.deferRageQuitRewardCleanup(MARKET_ID, ALICE);

        _schedule(CHARLIE, 1);
        (,,, bool redistributed) = manager.rageQuit(gauge, ALICE);

        assertFalse(redistributed);
        assertEq(gauge.rewardState(address(quote)).indexRemainder, 1);
    }

    function test_rageQuitCutoffExcludesFeesCreditedAfterCutoffAndForfeitsPriorRewards() public {
        (uint64 generation,) = _schedule(ALICE, 100);
        vm.warp(generation);

        feeVault.credit(gauge, address(quote), 100, keccak256("before-cutoff"));
        manager.snapshotRageQuitRewardCutoff(MARKET_ID, ALICE);
        feeVault.credit(gauge, address(quote), 100, keccak256("after-cutoff"));

        (uint256 principal, uint256 quoteForfeited,,) = manager.rageQuit(gauge, ALICE);
        assertEq(principal, 100);
        // Only rewards accounted for at the cutoff can be settled and forfeited. The later fee is not ALICE's.
        assertEq(quoteForfeited, 100);
        (uint256 deferredQuote,) = gauge.deferredForfeiture();
        assertEq(deferredQuote, 100);
        assertEq(gauge.positionOf(ALICE).quoteClaimable, 0);
    }

    function test_deferredRageQuitCancelsPendingProcessedAfterCutoffWithoutPostExitRewards() public {
        (uint64 bobGeneration,) = _schedule(BOB, 100);
        vm.warp(bobGeneration);
        feeVault.settle(gauge, BOB);

        (uint64 aliceGeneration,) = _schedule(ALICE, 100);
        manager.deferRageQuitRewardCleanup(MARKET_ID, ALICE);

        // The departed pending weight is excluded by the authoritative manager while Bob receives the fee.
        feeVault.credit(gauge, address(quote), 100, keccak256("post-exit-before-activation"));
        assertEq(gauge.positionOf(ALICE).quoteClaimable, 0);
        assertEq(gauge.positionOf(BOB).quoteClaimable, 100);

        // A later checkpoint may process the stale Gauge bucket at a newer accumulator. Cleanup must cancel
        // that bucket instead of attempting to accrue backwards to the earlier rage-quit cutoff.
        vm.warp(aliceGeneration);
        gauge.checkpointActivations();
        assertEq(gauge.positionOf(ALICE).quoteClaimable, 0);

        (uint256 principal, uint256 quoteForfeited, uint256 memeForfeited,) = manager.rageQuit(gauge, ALICE);
        assertEq(principal, 100);
        assertEq(quoteForfeited, 0);
        assertEq(memeForfeited, 0);
        assertEq(gauge.positionOf(ALICE).activeAmount, 0);
        assertEq(gauge.positionOf(ALICE).pendingAmount, 0);
        assertEq(gauge.storedTotalActiveStock(), 100);
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

    function test_canonicalSelectorsMatchInterface() public pure {
        assertEq(MemeStockGauge.gaugeIdentity.selector, IMemeStockGauge.gaugeIdentity.selector);
        assertEq(MemeStockGauge.addPending.selector, IMemeStockGauge.addPending.selector);
        assertEq(MemeStockGauge.removeAllocation.selector, IMemeStockGauge.removeAllocation.selector);
        assertEq(MemeStockGauge.rageQuit.selector, IMemeStockGauge.rageQuit.selector);
        assertEq(MemeStockGauge.checkpointActivations.selector, IMemeStockGauge.checkpointActivations.selector);
        assertEq(MemeStockGauge.flushDeferredForfeiture.selector, IMemeStockGauge.flushDeferredForfeiture.selector);
        assertEq(MemeStockGauge.settle.selector, IMemeStockGauge.settle.selector);
        assertEq(MemeStockGauge.creditStakerFee.selector, IMemeStockGauge.creditStakerFee.selector);
        assertEq(MemeStockGauge.consumeClaimable.selector, IMemeStockGauge.consumeClaimable.selector);
        assertEq(MemeStockGauge.deferredForfeiture.selector, IMemeStockGauge.deferredForfeiture.selector);
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
