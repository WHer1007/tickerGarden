// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {stdError} from "forge-std/StdError.sol";

import {ActivationSlot, ActivationSnapshot} from "../../../src/v1/interfaces/IV1Protocol.sol";
import {MemeStockGaugeActivationWheel} from "../../../src/v1/shared/MemeStockGaugeActivationWheel.sol";
import {MemeStockGaugePendingPositions} from "../../../src/v1/shared/MemeStockGaugePendingPositions.sol";

contract MemeStockGaugePendingPositionsHarness is MemeStockGaugePendingPositions {
    bytes32 public constant MARKET_ID = keccak256("pending-market");

    uint256 public quoteAccumulator;
    uint256 public memeAccumulator;
    uint256 public settlementCalls;
    bool public failSettlement;

    error InjectedSettlementFailure();

    function setAccumulators(uint256 quoteAccumulator_, uint256 memeAccumulator_) external {
        quoteAccumulator = quoteAccumulator_;
        memeAccumulator = memeAccumulator_;
    }

    function setFailSettlement(bool fail) external {
        failSettlement = fail;
    }

    function addPending(address user, uint256 amount, uint64 generation, uint64 unlockAt)
        external
        returns (uint256 combinedAmount, uint64 actualGeneration, uint64 actualUnlockAt)
    {
        return _addPending(user, amount, generation, unlockAt, MARKET_ID, quoteAccumulator, memeAccumulator);
    }

    function checkpoint() external returns (uint256 activatedAmount, uint256 processedBuckets) {
        return _checkpointActivations(MARKET_ID, quoteAccumulator, memeAccumulator);
    }

    function expectedTimes() external view returns (uint64 generation, uint64 unlockAt) {
        return (_nextActivationGeneration(), _nextPositionUnlockAt());
    }

    function positionAmounts(address user)
        external
        view
        returns (uint256 activeAmount, uint256 pendingAmount, uint64 pendingGeneration, uint64 unlockAt)
    {
        GaugePosition storage position = _gaugePositions[user];
        return (position.activeAmount, position.pendingAmount, position.pendingGeneration, position.unlockAt);
    }

    function paidIndices(address user) external view returns (uint256 quotePaid, uint256 memePaid) {
        return (_gaugePositions[user].rewards[0].accumulatorPaid, _gaugePositions[user].rewards[1].accumulatorPaid);
    }

    function snapshot(uint64 generation) external view returns (ActivationSnapshot memory) {
        return _activationSnapshot(generation);
    }

    function slot(uint8 slotIndex) external view returns (ActivationSlot memory) {
        return _activationSlot(slotIndex);
    }

    function storedActive() external view returns (uint256) {
        return _storedTotalActiveStock;
    }

    function pendingTotal() external view returns (uint256) {
        return _totalPendingStock;
    }

    function effectiveUserActive(address user) external view returns (uint256) {
        return _effectiveUserActiveStock(user);
    }

    function seedPosition(
        address user,
        uint256 activeAmount,
        uint256 pendingAmount,
        uint64 pendingGeneration,
        uint64 unlockAt
    ) external {
        GaugePosition storage position = _gaugePositions[user];
        position.activeAmount = activeAmount;
        position.pendingAmount = pendingAmount;
        position.pendingGeneration = pendingGeneration;
        position.unlockAt = unlockAt;
    }

    function injectSlot(uint64 generation, uint256 amount, uint256 refs) external {
        uint8 index = uint8(generation % ACTIVATION_WHEEL_SIZE);
        _activationWheel[index] = ActivationSlot(generation, amount, refs);
        _totalPendingStock += amount;
    }

    function _settleMaterializingPosition(
        address,
        GaugePosition storage position,
        ActivationSnapshot memory,
        uint256 currentQuoteAccumulator,
        uint256 currentMemeAccumulator
    ) internal override {
        if (failSettlement) revert InjectedSettlementFailure();
        ++settlementCalls;
        position.rewards[0].accumulatorPaid = currentQuoteAccumulator;
        position.rewards[1].accumulatorPaid = currentMemeAccumulator;
    }
}

contract MemeStockGaugePendingPositionsTest is Test {
    address internal constant ALICE = address(0xA11CE);
    address internal constant BOB = address(0xB0B);
    bytes32 internal constant MARKET_ID = keccak256("pending-market");

    MemeStockGaugePendingPositionsHarness internal gauge;

    event PendingScheduled(
        address indexed user, bytes32 indexed marketId, uint256 amount, uint64 generation, uint64 unlockAt
    );
    event PendingRescheduled(
        address indexed user,
        bytes32 indexed marketId,
        uint64 oldGeneration,
        uint64 newGeneration,
        uint256 combinedAmount,
        uint64 unlockAt
    );
    event PendingMaterialized(
        address indexed user, bytes32 indexed marketId, uint64 indexed generation, uint256 amount
    );

    function setUp() public {
        gauge = new MemeStockGaugePendingPositionsHarness();
        vm.warp(1_000_000);
    }

    function test_firstPendingUsesExactManagerScheduleAndOneBucketReference() public {
        (uint64 generation, uint64 unlockAt) = gauge.expectedTimes();
        vm.expectEmit(true, true, false, true, address(gauge));
        emit PendingScheduled(ALICE, MARKET_ID, 100, generation, unlockAt);
        (uint256 combined, uint64 actualGeneration, uint64 actualUnlockAt) =
            gauge.addPending(ALICE, 100, generation, unlockAt);

        assertEq(combined, 100);
        assertEq(actualGeneration, generation);
        assertEq(actualUnlockAt, unlockAt);
        (uint256 active, uint256 pending, uint64 pendingGeneration, uint64 storedUnlock) = gauge.positionAmounts(ALICE);
        assertEq(active, 0);
        assertEq(pending, 100);
        assertEq(pendingGeneration, generation);
        assertEq(storedUnlock, unlockAt);
        ActivationSlot memory slot = gauge.slot(uint8(generation % 32));
        assertEq(slot.amount, 100);
        assertEq(slot.refs, 1);
        assertEq(gauge.pendingTotal(), 100);
    }

    function test_sameSecondIncreaseKeepsOneReferenceAndEmitsReschedule() public {
        (uint64 generation, uint64 unlockAt) = gauge.expectedTimes();
        gauge.addPending(ALICE, 100, generation, unlockAt);

        vm.expectEmit(true, true, false, true, address(gauge));
        emit PendingRescheduled(ALICE, MARKET_ID, generation, generation, 250, unlockAt);
        gauge.addPending(ALICE, 150, generation, unlockAt);

        (, uint256 pending, uint64 pendingGeneration, uint64 storedUnlock) = gauge.positionAmounts(ALICE);
        assertEq(pending, 250);
        assertEq(pendingGeneration, generation);
        assertEq(storedUnlock, unlockAt);
        ActivationSlot memory slot = gauge.slot(uint8(generation % 32));
        assertEq(slot.amount, 250);
        assertEq(slot.refs, 1);
        assertEq(gauge.pendingTotal(), 250);
    }

    function test_crossSecondIncreaseMovesOldBucketAndResetsBothTimers() public {
        (uint64 firstGeneration, uint64 firstUnlock) = gauge.expectedTimes();
        gauge.addPending(ALICE, 100, firstGeneration, firstUnlock);
        vm.warp(block.timestamp + 7);
        (uint64 secondGeneration, uint64 secondUnlock) = gauge.expectedTimes();

        vm.expectEmit(true, true, false, true, address(gauge));
        emit PendingRescheduled(ALICE, MARKET_ID, firstGeneration, secondGeneration, 140, secondUnlock);
        gauge.addPending(ALICE, 40, secondGeneration, secondUnlock);

        ActivationSlot memory oldSlot = gauge.slot(uint8(firstGeneration % 32));
        ActivationSlot memory newSlot = gauge.slot(uint8(secondGeneration % 32));
        assertEq(oldSlot.generation, 0);
        assertEq(newSlot.generation, secondGeneration);
        assertEq(newSlot.amount, 140);
        assertEq(newSlot.refs, 1);
        (, uint256 pending, uint64 storedGeneration, uint64 storedUnlock) = gauge.positionAmounts(ALICE);
        assertEq(pending, 140);
        assertEq(storedGeneration, secondGeneration);
        assertEq(storedUnlock, secondUnlock);
        assertGt(secondUnlock, firstUnlock);
        assertEq(gauge.pendingTotal(), 140);
    }

    function test_manyUsersDueTogetherAggregateAmountButRetainOneRefEach() public {
        (uint64 generation, uint64 unlockAt) = gauge.expectedTimes();
        gauge.addPending(ALICE, 100, generation, unlockAt);
        gauge.addPending(BOB, 300, generation, unlockAt);

        ActivationSlot memory slot = gauge.slot(uint8(generation % 32));
        assertEq(slot.amount, 400);
        assertEq(slot.refs, 2);
        assertEq(gauge.pendingTotal(), 400);
        (, uint256 alicePending,,) = gauge.positionAmounts(ALICE);
        (, uint256 bobPending,,) = gauge.positionAmounts(BOB);
        assertEq(alicePending, 100);
        assertEq(bobPending, 300);
    }

    function test_exactMaturityMaterializesOldPendingBeforeSchedulingOnlyNewDelta() public {
        gauge.seedPosition(ALICE, 25, 0, 0, 777);
        (uint64 oldGeneration, uint64 oldUnlock) = gauge.expectedTimes();
        gauge.addPending(ALICE, 100, oldGeneration, oldUnlock);
        gauge.setAccumulators(11, 22);
        vm.warp(oldGeneration);
        (uint64 newGeneration, uint64 newUnlock) = gauge.expectedTimes();

        vm.expectEmit(true, true, true, true, address(gauge));
        emit PendingMaterialized(ALICE, MARKET_ID, oldGeneration, 100);
        vm.expectEmit(true, true, false, true, address(gauge));
        emit PendingScheduled(ALICE, MARKET_ID, 40, newGeneration, newUnlock);
        gauge.addPending(ALICE, 40, newGeneration, newUnlock);

        (uint256 active, uint256 pending, uint64 pendingGeneration, uint64 unlockAt) = gauge.positionAmounts(ALICE);
        assertEq(active, 125);
        assertEq(pending, 40);
        assertEq(pendingGeneration, newGeneration);
        assertEq(unlockAt, newUnlock);
        assertEq(gauge.storedActive(), 100);
        assertEq(gauge.pendingTotal(), 40);
        assertFalse(gauge.snapshot(oldGeneration).processed);
        (uint256 quotePaid, uint256 memePaid) = gauge.paidIndices(ALICE);
        assertEq(quotePaid, 11);
        assertEq(memePaid, 22);
        assertEq(gauge.settlementCalls(), 1);
    }

    function test_oneSecondBeforeMaturityReschedulesWithoutMaterializing() public {
        (uint64 oldGeneration, uint64 oldUnlock) = gauge.expectedTimes();
        gauge.addPending(ALICE, 100, oldGeneration, oldUnlock);
        vm.warp(oldGeneration - 1);
        (uint64 newGeneration, uint64 newUnlock) = gauge.expectedTimes();
        gauge.addPending(ALICE, 20, newGeneration, newUnlock);

        (uint256 active, uint256 pending, uint64 pendingGeneration,) = gauge.positionAmounts(ALICE);
        assertEq(active, 0);
        assertEq(pending, 120);
        assertEq(pendingGeneration, newGeneration);
        assertEq(gauge.settlementCalls(), 0);
        assertFalse(gauge.snapshot(oldGeneration).processed);
        assertEq(gauge.pendingTotal(), 120);
    }

    function test_processedSharedSnapshotMaterializesOnlyTheIncreasingUser() public {
        (uint64 oldGeneration, uint64 oldUnlock) = gauge.expectedTimes();
        gauge.addPending(ALICE, 100, oldGeneration, oldUnlock);
        gauge.addPending(BOB, 200, oldGeneration, oldUnlock);
        vm.warp(oldGeneration);
        gauge.checkpoint();
        assertEq(gauge.snapshot(oldGeneration).refs, 2);
        (uint64 newGeneration, uint64 newUnlock) = gauge.expectedTimes();

        gauge.addPending(ALICE, 50, newGeneration, newUnlock);

        ActivationSnapshot memory oldSnapshot = gauge.snapshot(oldGeneration);
        assertTrue(oldSnapshot.processed);
        assertEq(oldSnapshot.refs, 1);
        (uint256 aliceActive, uint256 alicePending, uint64 aliceGeneration,) = gauge.positionAmounts(ALICE);
        (uint256 bobActive, uint256 bobPending, uint64 bobGeneration,) = gauge.positionAmounts(BOB);
        assertEq(aliceActive, 100);
        assertEq(alicePending, 50);
        assertEq(aliceGeneration, newGeneration);
        assertEq(bobActive, 0);
        assertEq(bobPending, 200);
        assertEq(bobGeneration, oldGeneration);
        assertEq(gauge.effectiveUserActive(BOB), 200);
    }

    function test_invalidCallerAmountAndManagerTimesRollbackCheckpoint() public {
        (uint64 generation, uint64 unlockAt) = gauge.expectedTimes();
        gauge.addPending(ALICE, 10, generation, unlockAt);
        vm.warp(generation);

        vm.expectRevert(abi.encodeWithSelector(MemeStockGaugePendingPositions.InvalidPendingUser.selector, address(0)));
        gauge.addPending(address(0), 1, uint64(block.timestamp + 30), uint64(block.timestamp + 20 minutes));
        assertEq(gauge.storedActive(), 0);
        assertEq(gauge.pendingTotal(), 10);

        vm.expectRevert(abi.encodeWithSelector(MemeStockGaugePendingPositions.InvalidPendingAmount.selector, 0));
        gauge.addPending(ALICE, 0, uint64(block.timestamp + 30), uint64(block.timestamp + 20 minutes));

        uint64 expectedGeneration = uint64(block.timestamp + 30);
        uint64 expectedUnlock = uint64(block.timestamp + 20 minutes);
        vm.expectRevert(
            abi.encodeWithSelector(
                MemeStockGaugePendingPositions.InvalidPendingSchedule.selector,
                expectedGeneration + 1,
                expectedUnlock,
                expectedGeneration,
                expectedUnlock
            )
        );
        gauge.addPending(ALICE, 1, expectedGeneration + 1, expectedUnlock);
        assertEq(gauge.storedActive(), 0);
        assertEq(gauge.pendingTotal(), 10);
    }

    function test_lockTimestampOverflowFailsWithoutScheduling() public {
        vm.warp(uint256(type(uint64).max) - 20 minutes + 1);
        uint64 generation = uint64(block.timestamp + 30);
        vm.expectRevert(
            abi.encodeWithSelector(
                MemeStockGaugePendingPositions.PositionLockTimestampOverflow.selector, block.timestamp
            )
        );
        gauge.addPending(ALICE, 1, generation, type(uint64).max);
        assertEq(gauge.pendingTotal(), 0);
    }

    function test_missingOldWheelReferenceFailsClosedAndPreservesPosition() public {
        uint64 oldGeneration = uint64(block.timestamp + 10);
        gauge.seedPosition(ALICE, 7, 80, oldGeneration, 123);
        (uint64 generation, uint64 unlockAt) = gauge.expectedTimes();

        vm.expectRevert(
            abi.encodeWithSelector(MemeStockGaugeActivationWheel.PendingGenerationNotFound.selector, oldGeneration)
        );
        gauge.addPending(ALICE, 20, generation, unlockAt);

        (uint256 active, uint256 pending, uint64 pendingGeneration, uint64 storedUnlock) = gauge.positionAmounts(ALICE);
        assertEq(active, 7);
        assertEq(pending, 80);
        assertEq(pendingGeneration, oldGeneration);
        assertEq(storedUnlock, 123);
        assertEq(gauge.pendingTotal(), 0);
    }

    function test_targetCollisionRollsBackOldUnscheduleAndPositionReset() public {
        uint64 oldGeneration = uint64(block.timestamp + 10);
        gauge.seedPosition(ALICE, 7, 80, oldGeneration, 123);
        gauge.injectSlot(oldGeneration, 80, 1);
        (uint64 newGeneration, uint64 newUnlock) = gauge.expectedTimes();
        uint64 collidingGeneration = newGeneration + 32;
        gauge.injectSlot(collidingGeneration, 90, 2);

        vm.expectRevert(
            abi.encodeWithSelector(
                MemeStockGaugeActivationWheel.ActivationSlotCollision.selector,
                uint8(newGeneration % 32),
                collidingGeneration,
                newGeneration
            )
        );
        gauge.addPending(ALICE, 20, newGeneration, newUnlock);

        (uint256 active, uint256 pending, uint64 pendingGeneration, uint64 storedUnlock) = gauge.positionAmounts(ALICE);
        assertEq(active, 7);
        assertEq(pending, 80);
        assertEq(pendingGeneration, oldGeneration);
        assertEq(storedUnlock, 123);
        ActivationSlot memory oldSlot = gauge.slot(uint8(oldGeneration % 32));
        ActivationSlot memory collisionSlot = gauge.slot(uint8(newGeneration % 32));
        assertEq(oldSlot.generation, oldGeneration);
        assertEq(oldSlot.amount, 80);
        assertEq(oldSlot.refs, 1);
        assertEq(collisionSlot.generation, collidingGeneration);
        assertEq(collisionSlot.amount, 90);
        assertEq(collisionSlot.refs, 2);
        assertEq(gauge.pendingTotal(), 170);
    }

    function test_materializationFailureRollsBackCheckpointAndNewSchedule() public {
        (uint64 oldGeneration, uint64 oldUnlock) = gauge.expectedTimes();
        gauge.addPending(ALICE, 100, oldGeneration, oldUnlock);
        vm.warp(oldGeneration);
        (uint64 newGeneration, uint64 newUnlock) = gauge.expectedTimes();
        gauge.setFailSettlement(true);

        vm.expectRevert(MemeStockGaugePendingPositionsHarness.InjectedSettlementFailure.selector);
        gauge.addPending(ALICE, 20, newGeneration, newUnlock);

        (uint256 active, uint256 pending, uint64 pendingGeneration, uint64 storedUnlock) = gauge.positionAmounts(ALICE);
        assertEq(active, 0);
        assertEq(pending, 100);
        assertEq(pendingGeneration, oldGeneration);
        assertEq(storedUnlock, oldUnlock);
        assertEq(gauge.storedActive(), 0);
        assertEq(gauge.pendingTotal(), 100);
        assertEq(gauge.slot(uint8(oldGeneration % 32)).generation, oldGeneration);
        assertFalse(gauge.snapshot(oldGeneration).processed);
    }

    function test_combinedAmountOverflowRollsBackOldUnschedule() public {
        uint64 oldGeneration = uint64(block.timestamp + 10);
        gauge.seedPosition(ALICE, 0, type(uint256).max, oldGeneration, 1);
        gauge.injectSlot(oldGeneration, type(uint256).max, 1);
        (uint64 generation, uint64 unlockAt) = gauge.expectedTimes();

        vm.expectRevert(stdError.arithmeticError);
        gauge.addPending(ALICE, 1, generation, unlockAt);

        (, uint256 pending, uint64 pendingGeneration,) = gauge.positionAmounts(ALICE);
        assertEq(pending, type(uint256).max);
        assertEq(pendingGeneration, oldGeneration);
        ActivationSlot memory slot = gauge.slot(uint8(oldGeneration % 32));
        assertEq(slot.amount, type(uint256).max);
        assertEq(slot.refs, 1);
        assertEq(gauge.pendingTotal(), type(uint256).max);
    }

    function test_oneYearIdleIncreaseStillProcessesOneOldBucketThenCreatesOnePending() public {
        (uint64 oldGeneration, uint64 oldUnlock) = gauge.expectedTimes();
        gauge.addPending(ALICE, 70, oldGeneration, oldUnlock);
        vm.warp(uint256(oldGeneration) + 365 days);
        (uint64 newGeneration, uint64 newUnlock) = gauge.expectedTimes();
        gauge.addPending(ALICE, 30, newGeneration, newUnlock);

        (uint256 active, uint256 pending, uint64 pendingGeneration,) = gauge.positionAmounts(ALICE);
        assertEq(active, 70);
        assertEq(pending, 30);
        assertEq(pendingGeneration, newGeneration);
        assertEq(gauge.storedActive(), 70);
        assertEq(gauge.pendingTotal(), 30);
        assertEq(gauge.settlementCalls(), 1);
    }

    function testFuzz_repeatedFutureResetsKeepExactlyOnePendingReference(
        uint8 resetCount,
        uint96 initialAmount,
        uint96 delta
    ) public {
        resetCount = uint8(bound(resetCount, 1, 20));
        initialAmount = uint96(bound(initialAmount, 1, type(uint96).max));
        delta = uint96(bound(delta, 1, type(uint96).max));
        (uint64 generation, uint64 unlockAt) = gauge.expectedTimes();
        gauge.addPending(ALICE, initialAmount, generation, unlockAt);
        uint256 expected = initialAmount;

        for (uint256 i; i < resetCount; ++i) {
            vm.warp(block.timestamp + 1);
            (generation, unlockAt) = gauge.expectedTimes();
            gauge.addPending(ALICE, delta, generation, unlockAt);
            expected += delta;
        }

        (, uint256 pending, uint64 storedGeneration, uint64 storedUnlock) = gauge.positionAmounts(ALICE);
        assertEq(pending, expected);
        assertEq(storedGeneration, generation);
        assertEq(storedUnlock, unlockAt);
        ActivationSlot memory slot = gauge.slot(uint8(generation % 32));
        assertEq(slot.amount, expected);
        assertEq(slot.refs, 1);
        assertEq(gauge.pendingTotal(), expected);
        assertEq(gauge.settlementCalls(), 0);
    }
}
