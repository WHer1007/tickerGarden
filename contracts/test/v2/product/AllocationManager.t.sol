// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";

import {
    AssetView,
    IAllocationManager,
    IUserStockVault,
    MarketView,
    PositionView
} from "../../../src/v2/interfaces/IV2Protocol.sol";
import {AllocationManager} from "../../../src/v2/modules/AllocationManager.sol";
import {UserStockVault} from "../../../src/v2/modules/UserStockVault.sol";
import {AllocationManagerDecreases} from "../../../src/v2/shared/AllocationManagerDecreases.sol";
import {AllocationManagerIncreases} from "../../../src/v2/shared/AllocationManagerIncreases.sol";
import {AllocationManagerMigrations} from "../../../src/v2/shared/AllocationManagerMigrations.sol";
import {MockExactQuoteToken} from "../mocks/MockV2QuoteAssets.sol";

contract MockMigrationOfficialStockRegistry {
    mapping(bytes32 assetUid => AssetView assetView) private _assets;

    function configure(bytes32 assetUid, address token, address vault, uint8 decimals, uint8 status) external {
        _assets[assetUid] = AssetView(token, vault, decimals, status);
    }

    function setStatus(bytes32 assetUid, uint8 status) external {
        _assets[assetUid].status = status;
    }

    function asset(bytes32 assetUid) external view returns (AssetView memory) {
        return _assets[assetUid];
    }
}

contract MockMigrationMarketRegistry {
    mapping(bytes32 marketId => MarketView marketView) private _markets;
    mapping(bytes32 marketId => bool registered) private _registered;

    error MarketNotRegistered(bytes32 marketId);

    function configure(bytes32 marketId, bytes32 assetUid, address gauge, uint8 launchPhase, uint8 status) external {
        _registered[marketId] = true;
        _markets[marketId].config.assetUid = assetUid;
        _markets[marketId].config.gauge = gauge;
        _markets[marketId].runtime.launchPhase = launchPhase;
        _markets[marketId].runtime.marketStatus = status;
    }

    function market(bytes32 marketId) external view returns (MarketView memory) {
        if (!_registered[marketId]) revert MarketNotRegistered(marketId);
        return _markets[marketId];
    }
}

contract MigrationCallLog {
    uint256 public sequence;

    function record() external returns (uint256) {
        return ++sequence;
    }

    function reset() external {
        sequence = 0;
    }
}

contract MockMigrationGauge {
    uint8 internal constant FAIL_CHECKPOINT = 1;
    uint8 internal constant FAIL_SETTLE = 2;
    uint8 internal constant FAIL_REMOVE = 3;
    uint8 internal constant NOOP_REMOVE = 4;
    uint8 internal constant FAIL_ADD = 5;
    uint8 internal constant NOOP_ADD = 6;
    uint8 internal constant KEEP_MATURE_PENDING = 7;
    uint8 internal constant REENTER = 8;
    uint8 internal constant WRONG_TARGET_SCHEDULE = 9;
    uint8 internal constant CHANGE_SOURCE_UNLOCK = 10;

    address public manager;
    IUserStockVault public vault;
    bytes32 public marketId;
    bytes32 public peerMarketId;
    MigrationCallLog public callLog;
    uint8 public failureMode;
    uint256 public lastCheckpointSequence;
    uint256 public lastSettleSequence;
    uint256 public lastRemoveSequence;
    uint256 public lastAddSequence;
    mapping(address user => PositionView position) private _positions;

    error InjectedGaugeFailure(uint8 stage);
    error InvalidManager(address caller);
    error InvalidVaultOrder(uint256 expected, uint256 actual);

    function configure(
        address manager_,
        IUserStockVault vault_,
        bytes32 marketId_,
        bytes32 peerMarketId_,
        MigrationCallLog callLog_
    ) external {
        manager = manager_;
        vault = vault_;
        marketId = marketId_;
        peerMarketId = peerMarketId_;
        callLog = callLog_;
    }

    function setFailureMode(uint8 mode) external {
        failureMode = mode;
    }

    function setPosition(address user, uint256 active, uint256 pending, uint64 generation, uint64 unlockAt) external {
        _positions[user] = PositionView({
            activeAmount: active,
            pendingAmount: pending,
            pendingGeneration: generation,
            unlockAt: unlockAt,
            quoteClaimable: 0,
            memeClaimable: 0
        });
    }

    function resetTrace() external {
        lastCheckpointSequence = 0;
        lastSettleSequence = 0;
        lastRemoveSequence = 0;
        lastAddSequence = 0;
    }

    function checkpointActivations() external returns (uint256, uint256) {
        _onlyManager();
        if (failureMode == FAIL_CHECKPOINT) revert InjectedGaugeFailure(FAIL_CHECKPOINT);
        lastCheckpointSequence = callLog.record();
        return (0, 0);
    }

    function settle(address user) external {
        _onlyManager();
        if (failureMode == FAIL_SETTLE) revert InjectedGaugeFailure(FAIL_SETTLE);
        lastSettleSequence = callLog.record();
        PositionView storage position = _positions[user];
        if (
            failureMode != KEEP_MATURE_PENDING && position.pendingAmount != 0
                && block.timestamp >= position.pendingGeneration
        ) {
            position.activeAmount += position.pendingAmount;
            position.pendingAmount = 0;
            position.pendingGeneration = 0;
        }
    }

    function removeAllocation(address user, uint256 amount) external {
        _onlyManager();
        if (failureMode == FAIL_REMOVE) revert InjectedGaugeFailure(FAIL_REMOVE);
        PositionView storage position = _positions[user];
        uint256 current = position.activeAmount + position.pendingAmount;
        uint256 vaultAmount = vault.allocation(user, marketId);
        if (vaultAmount != current) revert InvalidVaultOrder(current, vaultAmount);
        lastRemoveSequence = callLog.record();
        if (failureMode == REENTER) {
            IAllocationManager(manager).migrateAllocation(marketId, peerMarketId, 1);
        }
        if (failureMode == NOOP_REMOVE) return;
        position.activeAmount -= amount;
        if (failureMode == CHANGE_SOURCE_UNLOCK) ++position.unlockAt;
    }

    function addPending(address user, uint256 amount, uint64 activationAt, uint64 unlockAt) external {
        _onlyManager();
        if (failureMode == FAIL_ADD) revert InjectedGaugeFailure(FAIL_ADD);
        PositionView storage position = _positions[user];
        uint256 expected = position.activeAmount + position.pendingAmount + amount;
        uint256 vaultAmount = vault.allocation(user, marketId);
        if (vaultAmount != expected) revert InvalidVaultOrder(expected, vaultAmount);
        lastAddSequence = callLog.record();
        if (failureMode == REENTER) {
            IAllocationManager(manager).migrateAllocation(peerMarketId, marketId, 1);
        }
        if (failureMode == NOOP_ADD) return;
        position.pendingAmount += amount;
        position.pendingGeneration = failureMode == WRONG_TARGET_SCHEDULE ? activationAt + 1 : activationAt;
        position.unlockAt = unlockAt;
    }

    function positionOf(address user) external view returns (PositionView memory) {
        return _positions[user];
    }

    function _onlyManager() private view {
        if (msg.sender != manager) revert InvalidManager(msg.sender);
    }
}

contract AllocationManagerTest is Test {
    bytes32 internal constant ASSET_UID = keccak256("official-stock");
    bytes32 internal constant OTHER_ASSET_UID = keccak256("other-stock");
    bytes32 internal constant FROM_MARKET = keccak256("from-market");
    bytes32 internal constant TO_MARKET = keccak256("to-market");
    bytes32 internal constant OTHER_MARKET = keccak256("other-market");
    address internal constant ALICE = address(0xA11CE);
    address internal constant BOB = address(0xB0B);

    MockMigrationOfficialStockRegistry internal officialRegistry;
    MockMigrationMarketRegistry internal marketRegistry;
    AllocationManager internal manager;
    MockExactQuoteToken internal stockToken;
    UserStockVault internal vault;
    MockMigrationGauge internal sourceGauge;
    MockMigrationGauge internal targetGauge;
    MigrationCallLog internal callLog;

    event AllocationMoved(
        address indexed user, bytes32 indexed fromMarketId, bytes32 indexed toMarketId, uint256 amount
    );
    event AllocationMigrated(
        address indexed user,
        bytes32 indexed fromMarketId,
        bytes32 indexed toMarketId,
        uint256 amount,
        uint256 sourceRemaining,
        uint64 targetPendingGeneration,
        uint64 targetUnlockAt
    );

    function setUp() public {
        officialRegistry = new MockMigrationOfficialStockRegistry();
        marketRegistry = new MockMigrationMarketRegistry();
        manager = new AllocationManager(address(officialRegistry), address(marketRegistry));
        stockToken = new MockExactQuoteToken(18);
        callLog = new MigrationCallLog();
        sourceGauge = new MockMigrationGauge();
        targetGauge = new MockMigrationGauge();
        vault = new UserStockVault(
            address(officialRegistry), address(marketRegistry), address(manager), ASSET_UID, address(stockToken)
        );
        officialRegistry.configure(ASSET_UID, address(stockToken), address(vault), 18, 1);
        marketRegistry.configure(FROM_MARKET, ASSET_UID, address(sourceGauge), 2, 0);
        marketRegistry.configure(TO_MARKET, ASSET_UID, address(targetGauge), 2, 0);
        sourceGauge.configure(address(manager), vault, FROM_MARKET, TO_MARKET, callLog);
        targetGauge.configure(address(manager), vault, TO_MARKET, FROM_MARKET, callLog);
    }

    function test_migrateSettlesBothRemovesMovesThenAddsPendingAndEmitsCanonicalEvent() public {
        vm.warp(1_000_000);
        _seed(ALICE, 2 ether, 1 ether);
        uint64 sourceUnlock = sourceGauge.positionOf(ALICE).unlockAt;
        vm.warp(sourceUnlock);
        _resetTrace();

        vm.expectEmit(true, true, true, true, address(vault));
        emit AllocationMoved(ALICE, FROM_MARKET, TO_MARKET, 0.75 ether);
        vm.expectEmit(true, true, true, true, address(manager));
        emit AllocationMigrated(
            ALICE,
            FROM_MARKET,
            TO_MARKET,
            0.75 ether,
            1.25 ether,
            uint64(block.timestamp + 30 seconds),
            uint64(block.timestamp + 24 hours)
        );
        vm.prank(ALICE);
        manager.migrateAllocation(FROM_MARKET, TO_MARKET, 0.75 ether);

        PositionView memory source = sourceGauge.positionOf(ALICE);
        PositionView memory target = targetGauge.positionOf(ALICE);
        assertEq(source.activeAmount, 1.25 ether);
        assertEq(source.pendingAmount, 0);
        assertEq(source.unlockAt, sourceUnlock);
        assertEq(target.activeAmount, 1 ether);
        assertEq(target.pendingAmount, 0.75 ether);
        assertEq(target.pendingGeneration, block.timestamp + 30 seconds);
        assertEq(target.unlockAt, block.timestamp + 24 hours);
        assertEq(vault.allocation(ALICE, FROM_MARKET), 1.25 ether);
        assertEq(vault.allocation(ALICE, TO_MARKET), 1.75 ether);
        assertEq(vault.deposited(ALICE), 3 ether);
        assertEq(vault.allocated(ALICE), 3 ether);
        assertEq(vault.freeBalanceOf(ALICE), 0);
        assertEq(vault.totalDeposited(), 3 ether);
        assertEq(vault.totalAllocated(), 3 ether);
        assertEq(stockToken.balanceOf(address(vault)), 3 ether);
        assertEq(stockToken.balanceOf(address(manager)), 0);

        assertEq(sourceGauge.lastCheckpointSequence(), 1);
        assertEq(sourceGauge.lastSettleSequence(), 2);
        assertEq(sourceGauge.lastRemoveSequence(), 3);
        assertEq(targetGauge.lastCheckpointSequence(), 4);
        assertEq(targetGauge.lastSettleSequence(), 5);
        assertEq(targetGauge.lastAddSequence(), 6);
    }

    function test_fullMigrationClearsSourceAndCreatesTargetPendingWithoutMovingStock() public {
        vm.warp(2_000_000);
        _seed(ALICE, 1 ether, 0);
        vm.warp(sourceGauge.positionOf(ALICE).unlockAt);
        uint256 vaultTokenBalance = stockToken.balanceOf(address(vault));

        vm.prank(ALICE);
        manager.migrateAllocation(FROM_MARKET, TO_MARKET, 1 ether);

        assertEq(_positionAmount(sourceGauge, ALICE), 0);
        assertEq(sourceGauge.positionOf(ALICE).pendingAmount, 0);
        assertEq(targetGauge.positionOf(ALICE).activeAmount, 0);
        assertEq(targetGauge.positionOf(ALICE).pendingAmount, 1 ether);
        assertEq(vault.allocation(ALICE, FROM_MARKET), 0);
        assertEq(vault.allocation(ALICE, TO_MARKET), 1 ether);
        assertEq(stockToken.balanceOf(address(vault)), vaultTokenBalance);
    }

    function test_migrationMergesImmatureTargetPendingAndResetsBothTargetTimers() public {
        vm.warp(2_500_000);
        _seed(ALICE, 2 ether, 0);
        vm.warp(sourceGauge.positionOf(ALICE).unlockAt);
        _seed(ALICE, 0, 1 ether);
        PositionView memory beforeTarget = targetGauge.positionOf(ALICE);
        vm.warp(block.timestamp + 10 seconds);

        vm.prank(ALICE);
        manager.migrateAllocation(FROM_MARKET, TO_MARKET, 0.75 ether);

        PositionView memory target = targetGauge.positionOf(ALICE);
        assertEq(target.activeAmount, 0);
        assertEq(target.pendingAmount, 1.75 ether);
        assertEq(target.pendingGeneration, block.timestamp + 30 seconds);
        assertEq(target.unlockAt, block.timestamp + 24 hours);
        assertGt(target.pendingGeneration, beforeTarget.pendingGeneration);
        assertGt(target.unlockAt, beforeTarget.unlockAt);
    }

    function test_sourcePausedOrRetiredCanMigrateAtMaturityButEmergencyCannot() public {
        vm.warp(3_000_000);
        _seed(ALICE, 1 ether, 0);
        _seed(BOB, 1 ether, 0);
        _seed(address(0xCAFE), 1 ether, 0);
        vm.warp(sourceGauge.positionOf(ALICE).unlockAt);

        marketRegistry.configure(FROM_MARKET, ASSET_UID, address(sourceGauge), 2, 1);
        vm.prank(ALICE);
        manager.migrateAllocation(FROM_MARKET, TO_MARKET, 1 ether);
        marketRegistry.configure(FROM_MARKET, ASSET_UID, address(sourceGauge), 2, 2);
        vm.prank(BOB);
        manager.migrateAllocation(FROM_MARKET, TO_MARKET, 1 ether);

        marketRegistry.configure(FROM_MARKET, ASSET_UID, address(sourceGauge), 2, 3);
        vm.expectRevert(abi.encodeWithSelector(AllocationManagerIncreases.StockAllocationClosed.selector, FROM_MARKET));
        vm.prank(address(0xCAFE));
        manager.migrateAllocation(FROM_MARKET, TO_MARKET, 1 ether);
    }

    function test_targetMustBePoolCreatedActiveAndAssetActiveBeforeGaugeWrites() public {
        vm.warp(4_000_000);
        _seed(ALICE, 1 ether, 0);
        vm.warp(sourceGauge.positionOf(ALICE).unlockAt);
        _resetTrace();

        for (uint8 phase; phase < 4; ++phase) {
            if (phase == 2) continue;
            marketRegistry.configure(TO_MARKET, ASSET_UID, address(targetGauge), phase, 0);
            vm.expectRevert(
                abi.encodeWithSelector(AllocationManagerIncreases.StockAllocationClosed.selector, TO_MARKET)
            );
            vm.prank(ALICE);
            manager.migrateAllocation(FROM_MARKET, TO_MARKET, 1 ether);
        }
        for (uint8 status = 1; status < 4; ++status) {
            marketRegistry.configure(TO_MARKET, ASSET_UID, address(targetGauge), 2, status);
            vm.expectRevert(
                abi.encodeWithSelector(AllocationManagerIncreases.StockAllocationClosed.selector, TO_MARKET)
            );
            vm.prank(ALICE);
            manager.migrateAllocation(FROM_MARKET, TO_MARKET, 1 ether);
        }
        marketRegistry.configure(TO_MARKET, ASSET_UID, address(targetGauge), 2, 0);
        officialRegistry.setStatus(ASSET_UID, 2);
        vm.expectRevert(abi.encodeWithSelector(AllocationManagerIncreases.StockAllocationClosed.selector, TO_MARKET));
        vm.prank(ALICE);
        manager.migrateAllocation(FROM_MARKET, TO_MARKET, 1 ether);
        assertEq(callLog.sequence(), 0);
        assertEq(vault.allocation(ALICE, FROM_MARKET), 1 ether);
    }

    function test_unlockBoundaryAndMaturePendingMaterializationAreExact() public {
        vm.warp(5_000_000);
        _seed(ALICE, 1 ether, 0);
        uint64 unlockAt = sourceGauge.positionOf(ALICE).unlockAt;
        vm.warp(unlockAt - 1);
        vm.expectRevert(abi.encodeWithSelector(AllocationManagerDecreases.PositionLockedUntil.selector, unlockAt));
        vm.prank(ALICE);
        manager.migrateAllocation(FROM_MARKET, TO_MARKET, 1 ether);

        vm.warp(unlockAt);
        vm.prank(ALICE);
        manager.migrateAllocation(FROM_MARKET, TO_MARKET, 1 ether);
        assertEq(sourceGauge.positionOf(ALICE).pendingAmount, 0);
        assertEq(targetGauge.positionOf(ALICE).pendingAmount, 1 ether);
    }

    function test_sourceAndTargetMinimumRawUnitBoundaries() public {
        vm.warp(6_000_000);
        _seed(ALICE, 1 ether, 1 ether);
        vm.warp(sourceGauge.positionOf(ALICE).unlockAt);

        vm.expectRevert(
            abi.encodeWithSelector(
                AllocationManagerIncreases.PositionBelowMinimum.selector, uint256(0.5 ether), uint256(0.5 ether + 1)
            )
        );
        vm.prank(ALICE);
        manager.migrateAllocation(FROM_MARKET, TO_MARKET, 0.5 ether);

        vm.prank(ALICE);
        manager.migrateAllocation(FROM_MARKET, TO_MARKET, 0.5 ether - 1);
        assertEq(vault.allocation(ALICE, FROM_MARKET), 0.5 ether + 1);

        address carol = address(0xCA401);
        _seed(carol, 1.5 ether, 0);
        vm.warp(sourceGauge.positionOf(carol).unlockAt);
        vm.expectRevert(
            abi.encodeWithSelector(
                AllocationManagerIncreases.PositionBelowMinimum.selector, uint256(0.5 ether), uint256(0.5 ether + 1)
            )
        );
        vm.prank(carol);
        manager.migrateAllocation(FROM_MARKET, TO_MARKET, 0.5 ether);
        vm.prank(carol);
        manager.migrateAllocation(FROM_MARKET, TO_MARKET, 0.5 ether + 1);
        assertEq(vault.allocation(carol, TO_MARKET), 0.5 ether + 1);
    }

    function test_sameMarketZeroOverAllocationEmptyAndWrongIdentityFailAtomically() public {
        vm.warp(7_000_000);
        _seed(ALICE, 1 ether, 0);
        vm.warp(sourceGauge.positionOf(ALICE).unlockAt);

        vm.expectRevert(
            abi.encodeWithSelector(
                AllocationManagerMigrations.InvalidMigrationMarkets.selector, FROM_MARKET, FROM_MARKET
            )
        );
        vm.prank(ALICE);
        manager.migrateAllocation(FROM_MARKET, FROM_MARKET, 1 ether);
        vm.expectRevert(abi.encodeWithSelector(AllocationManagerIncreases.InvalidAllocationAmount.selector, uint256(0)));
        vm.prank(ALICE);
        manager.migrateAllocation(FROM_MARKET, TO_MARKET, 0);
        vm.expectRevert();
        vm.prank(ALICE);
        manager.migrateAllocation(FROM_MARKET, TO_MARKET, 1 ether + 1);
        vm.expectRevert();
        vm.prank(BOB);
        manager.migrateAllocation(FROM_MARKET, TO_MARKET, 1 ether);

        assertEq(vault.allocation(ALICE, FROM_MARKET), 1 ether);
        assertEq(vault.allocation(ALICE, TO_MARKET), 0);
    }

    function test_crossAssetAndAliasedGaugeRoutesFailBeforeAnyGaugeCall() public {
        MockExactQuoteToken otherToken = new MockExactQuoteToken(18);
        MockMigrationGauge otherGauge = new MockMigrationGauge();
        UserStockVault otherVault = new UserStockVault(
            address(officialRegistry), address(marketRegistry), address(manager), OTHER_ASSET_UID, address(otherToken)
        );
        officialRegistry.configure(OTHER_ASSET_UID, address(otherToken), address(otherVault), 18, 1);
        marketRegistry.configure(OTHER_MARKET, OTHER_ASSET_UID, address(otherGauge), 2, 0);
        otherGauge.configure(address(manager), otherVault, OTHER_MARKET, FROM_MARKET, callLog);

        vm.expectRevert(
            abi.encodeWithSelector(
                AllocationManagerMigrations.MigrationAssetMismatch.selector, ASSET_UID, OTHER_ASSET_UID
            )
        );
        vm.prank(ALICE);
        manager.migrateAllocation(FROM_MARKET, OTHER_MARKET, 1 ether);

        marketRegistry.configure(TO_MARKET, ASSET_UID, address(sourceGauge), 2, 0);
        vm.expectRevert(
            abi.encodeWithSelector(AllocationManagerMigrations.MigrationGaugeAlias.selector, address(sourceGauge))
        );
        vm.prank(ALICE);
        manager.migrateAllocation(FROM_MARKET, TO_MARKET, 1 ether);
        assertEq(callLog.sequence(), 0);
    }

    function test_sourceAndTargetGaugeFailuresNoopsAndScheduleDriftRollbackEverything() public {
        vm.warp(8_000_000);
        _seed(ALICE, 2 ether, 1 ether);
        vm.warp(sourceGauge.positionOf(ALICE).unlockAt);
        _resetTrace();

        uint8[6] memory sourceModes = [uint8(1), 2, 3, 4, 8, 10];
        for (uint256 i; i < sourceModes.length; ++i) {
            sourceGauge.setFailureMode(sourceModes[i]);
            vm.expectRevert();
            vm.prank(ALICE);
            manager.migrateAllocation(FROM_MARKET, TO_MARKET, 0.75 ether);
            sourceGauge.setFailureMode(0);
            _assertOriginalState();
        }

        uint8[6] memory targetModes = [uint8(1), 2, 5, 6, 8, 9];
        for (uint256 i; i < targetModes.length; ++i) {
            targetGauge.setFailureMode(targetModes[i]);
            vm.expectRevert();
            vm.prank(ALICE);
            manager.migrateAllocation(FROM_MARKET, TO_MARKET, 0.75 ether);
            targetGauge.setFailureMode(0);
            _assertOriginalState();
        }
    }

    function test_unmaterializedSourceAndPreexistingLedgerDriftFailClosed() public {
        vm.warp(9_000_000);
        _seed(ALICE, 1 ether, 0);
        vm.warp(sourceGauge.positionOf(ALICE).unlockAt);
        sourceGauge.setFailureMode(7);
        vm.expectRevert(
            abi.encodeWithSelector(
                AllocationManagerMigrations.SourcePendingNotMaterialized.selector, FROM_MARKET, uint256(1 ether)
            )
        );
        vm.prank(ALICE);
        manager.migrateAllocation(FROM_MARKET, TO_MARKET, 1 ether);
        sourceGauge.setFailureMode(0);

        sourceGauge.setPosition(ALICE, 2 ether, 0, 0, uint64(block.timestamp));
        vm.expectRevert(AllocationManagerIncreases.AllocationLedgerMismatch.selector);
        vm.prank(ALICE);
        manager.migrateAllocation(FROM_MARKET, TO_MARKET, 1 ether);

        sourceGauge.setPosition(ALICE, 1 ether, 0, 0, uint64(block.timestamp));
        targetGauge.setPosition(ALICE, 1 ether, 0, 0, uint64(block.timestamp));
        vm.expectRevert(AllocationManagerIncreases.AllocationLedgerMismatch.selector);
        vm.prank(ALICE);
        manager.migrateAllocation(FROM_MARKET, TO_MARKET, 1 ether);
    }

    function test_timestampOverflowAndReentrancyRollbackBeforeAnyMigrationStatePersists() public {
        vm.warp(10_000_000);
        _seed(ALICE, 1 ether, 0);
        uint64 originalUnlock = sourceGauge.positionOf(ALICE).unlockAt;
        vm.warp(uint256(type(uint64).max) - 24 hours + 1);
        vm.expectRevert(
            abi.encodeWithSelector(AllocationManagerIncreases.AllocationTimestampOverflow.selector, block.timestamp)
        );
        vm.prank(ALICE);
        manager.migrateAllocation(FROM_MARKET, TO_MARKET, 1 ether);
        assertEq(vault.allocation(ALICE, FROM_MARKET), 1 ether);

        vm.warp(originalUnlock);
        sourceGauge.setFailureMode(8);
        vm.expectRevert();
        vm.prank(ALICE);
        manager.migrateAllocation(FROM_MARKET, TO_MARKET, 1 ether);
        sourceGauge.setFailureMode(0);
        assertEq(vault.allocation(ALICE, FROM_MARKET), 1 ether);
        assertEq(vault.allocation(ALICE, TO_MARKET), 0);
    }

    function test_canonicalSelectorsAndNoForRecipientOrBatchMigrationSurface() public {
        assertEq(AllocationManager.allocate.selector, IAllocationManager.allocate.selector);
        assertEq(AllocationManager.increaseAllocation.selector, IAllocationManager.increaseAllocation.selector);
        assertEq(AllocationManager.decreaseAllocation.selector, IAllocationManager.decreaseAllocation.selector);
        assertEq(AllocationManager.closeAllocation.selector, IAllocationManager.closeAllocation.selector);
        assertEq(AllocationManager.migrateAllocation.selector, bytes4(0xc965083b));
        assertEq(AllocationManager.migrateAllocation.selector, IAllocationManager.migrateAllocation.selector);
        assertEq(AllocationManager.depositAndAllocate.selector, IAllocationManager.depositAndAllocate.selector);

        (bool forCall,) = address(manager)
            .call(
                abi.encodeWithSignature(
                    "migrateAllocationFor(address,bytes32,bytes32,uint256)", ALICE, FROM_MARKET, TO_MARKET, 1 ether
                )
            );
        assertFalse(forCall);
        (bool recipientCall,) = address(manager)
            .call(
                abi.encodeWithSignature(
                    "migrateAllocation(bytes32,bytes32,uint256,address)", FROM_MARKET, TO_MARKET, 1 ether, BOB
                )
            );
        assertFalse(recipientCall);
        (bool batchCall,) =
            address(manager).call(abi.encodeWithSignature("migrateAll(bytes32,bytes32)", FROM_MARKET, TO_MARKET));
        assertFalse(batchCall);
    }

    function testFuzz_migrationConservesEveryVaultAggregate(uint96 sourceSeed, uint96 targetSeed, uint96 moveSeed)
        public
    {
        uint256 sourceAmount = bound(uint256(sourceSeed), 1 ether, 1_000_000 ether);
        uint256 targetAmount = bound(uint256(targetSeed), 0.5 ether + 1, 1_000_000 ether);
        uint256 maxPartial = sourceAmount - (0.5 ether + 1);
        uint256 amount = maxPartial == 0 ? sourceAmount : bound(uint256(moveSeed), 1, maxPartial);
        vm.warp(11_000_000);
        _seed(ALICE, sourceAmount, targetAmount);
        vm.warp(sourceGauge.positionOf(ALICE).unlockAt);
        uint256 beforeDeposited = vault.totalDeposited();
        uint256 beforeAllocated = vault.totalAllocated();

        vm.prank(ALICE);
        manager.migrateAllocation(FROM_MARKET, TO_MARKET, amount);

        assertEq(vault.totalDeposited(), beforeDeposited);
        assertEq(vault.totalAllocated(), beforeAllocated);
        assertEq(vault.allocated(ALICE), sourceAmount + targetAmount);
        assertEq(vault.allocation(ALICE, FROM_MARKET), sourceAmount - amount);
        assertEq(vault.allocation(ALICE, TO_MARKET), targetAmount + amount);
        assertEq(_positionAmount(sourceGauge, ALICE), sourceAmount - amount);
        assertEq(_positionAmount(targetGauge, ALICE), targetAmount + amount);
    }

    function _seed(address user, uint256 sourceAmount, uint256 targetAmount) private {
        uint256 total = sourceAmount + targetAmount;
        stockToken.mint(user, total);
        vm.startPrank(user);
        stockToken.approve(address(vault), total);
        vault.depositStock(total);
        if (sourceAmount != 0) manager.allocate(FROM_MARKET, sourceAmount);
        if (targetAmount != 0) manager.allocate(TO_MARKET, targetAmount);
        vm.stopPrank();
    }

    function _resetTrace() private {
        callLog.reset();
        sourceGauge.resetTrace();
        targetGauge.resetTrace();
    }

    function _positionAmount(MockMigrationGauge gauge, address user) private view returns (uint256) {
        PositionView memory position = gauge.positionOf(user);
        return position.activeAmount + position.pendingAmount;
    }

    function _assertOriginalState() private view {
        assertEq(vault.deposited(ALICE), 3 ether);
        assertEq(vault.allocated(ALICE), 3 ether);
        assertEq(vault.allocation(ALICE, FROM_MARKET), 2 ether);
        assertEq(vault.allocation(ALICE, TO_MARKET), 1 ether);
        assertEq(_positionAmount(sourceGauge, ALICE), 2 ether);
        assertEq(_positionAmount(targetGauge, ALICE), 1 ether);
        assertEq(stockToken.balanceOf(address(vault)), 3 ether);
        assertEq(stockToken.balanceOf(address(manager)), 0);
    }
}
