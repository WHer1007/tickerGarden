// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";

import {ActivationSlot, ActivationSnapshot} from "../../../src/v1/interfaces/IV1Protocol.sol";
import {MemeStockGaugeActivationWheel} from "../../../src/v1/shared/MemeStockGaugeActivationWheel.sol";

contract MemeStockGaugeActivationWheelHarness is MemeStockGaugeActivationWheel {
    bytes32 public constant MARKET_ID = keccak256("wheel-market");

    mapping(uint64 generation => ActivationSnapshot snapshot) private _snapshots;
    uint256 public quoteAccumulator;
    uint256 public memeAccumulator;
    uint256 public snapshotWrites;
    bool public failSnapshotWrite;

    event ActivationBucketProcessed(
        bytes32 indexed marketId,
        uint64 indexed generation,
        uint256 amount,
        uint256 quoteAccumulator,
        uint256 memeAccumulator,
        uint256 refs
    );

    error SnapshotAlreadyProcessed(uint64 generation);
    error InjectedSnapshotFailure();

    function setAccumulators(uint256 quoteAccumulator_, uint256 memeAccumulator_) external {
        quoteAccumulator = quoteAccumulator_;
        memeAccumulator = memeAccumulator_;
    }

    function setFailSnapshotWrite(bool fail) external {
        failSnapshotWrite = fail;
    }

    function schedule(uint256 amount, uint256 refs) external returns (uint64 generation) {
        _checkpointActivations(MARKET_ID, quoteAccumulator, memeAccumulator);
        generation = _nextActivationGeneration();
        _scheduleActivation(generation, amount, refs);
    }

    function rawSchedule(uint64 generation, uint256 amount, uint256 refs) external {
        _scheduleActivation(generation, amount, refs);
    }

    function unschedule(uint64 generation, uint256 amount, uint256 refs) external {
        _unscheduleActivation(generation, amount, refs);
    }

    function checkpoint() external returns (uint256 activatedAmount, uint256 processedBuckets) {
        return _checkpointActivations(MARKET_ID, quoteAccumulator, memeAccumulator);
    }

    function slot(uint8 slotIndex) external view returns (ActivationSlot memory) {
        return _activationSlot(slotIndex);
    }

    function snapshot(uint64 generation) external view returns (ActivationSnapshot memory) {
        return _snapshots[generation];
    }

    function storedActive() external view returns (uint256) {
        return _storedTotalActiveStock;
    }

    function effectiveActive() external view returns (uint256 total) {
        total = _storedTotalActiveStock;
        for (uint8 i; i < ACTIVATION_WHEEL_SIZE; ++i) {
            ActivationSlot memory slot = _activationWheel[i];
            if (slot.generation != 0 && slot.generation <= block.timestamp) total += slot.amount;
        }
    }

    function pending() external view returns (uint256) {
        return _totalPendingStock;
    }

    function nextGeneration() external view returns (uint64) {
        return _nextActivationGeneration();
    }

    function injectSlot(uint8 slotIndex, uint64 generation, uint256 amount, uint256 refs) external {
        _activationWheel[slotIndex] = ActivationSlot(generation, amount, refs);
        _totalPendingStock += amount;
    }

    function _recordActivationSnapshot(
        bytes32 marketId,
        uint64 generation,
        uint256 amount,
        uint256 quoteAccumulator_,
        uint256 memeAccumulator_,
        uint256 refs
    ) internal override {
        if (failSnapshotWrite) revert InjectedSnapshotFailure();
        if (_snapshots[generation].processed) revert SnapshotAlreadyProcessed(generation);
        _snapshots[generation] = ActivationSnapshot(quoteAccumulator_, memeAccumulator_, refs, true);
        ++snapshotWrites;
        emit ActivationBucketProcessed(marketId, generation, amount, quoteAccumulator_, memeAccumulator_, refs);
    }
}

contract MemeStockGaugeActivationWheelTest is Test {
    bytes32 internal constant MARKET_ID = keccak256("wheel-market");

    MemeStockGaugeActivationWheelHarness internal wheel;

    event ActivationBucketProcessed(
        bytes32 indexed marketId,
        uint64 indexed generation,
        uint256 amount,
        uint256 quoteAccumulator,
        uint256 memeAccumulator,
        uint256 refs
    );

    function setUp() public {
        wheel = new MemeStockGaugeActivationWheelHarness();
        vm.warp(1_000_000);
    }

    function test_generationIsAbsoluteNowPlusThirtyAndSameSecondAggregatesOneSlot() public {
        uint64 expectedGeneration = uint64(block.timestamp + 30 seconds);
        assertEq(wheel.schedule(100, 1), expectedGeneration);
        assertEq(wheel.schedule(250, 1), expectedGeneration);

        uint8 slotIndex = uint8(expectedGeneration % 32);
        ActivationSlot memory slot = wheel.slot(slotIndex);
        assertEq(slot.generation, expectedGeneration);
        assertEq(slot.amount, 350);
        assertEq(slot.refs, 2);
        assertEq(wheel.pending(), 350);
        assertEq(wheel.storedActive(), 0);
    }

    function test_exactMaturityBoundaryMovesBucketFromPendingToActive() public {
        uint64 generation = wheel.schedule(777, 3);
        vm.warp(generation - 1);
        assertEq(wheel.effectiveActive(), 0);
        (uint256 amountBefore, uint256 bucketsBefore) = wheel.checkpoint();
        assertEq(amountBefore, 0);
        assertEq(bucketsBefore, 0);
        assertEq(wheel.pending(), 777);

        vm.warp(generation);
        assertEq(wheel.effectiveActive(), 777);
        vm.expectEmit(true, true, false, true, address(wheel));
        emit ActivationBucketProcessed(MARKET_ID, generation, 777, 0, 0, 3);
        (uint256 activatedAmount, uint256 processedBuckets) = wheel.checkpoint();
        assertEq(activatedAmount, 777);
        assertEq(processedBuckets, 1);
        assertEq(wheel.pending(), 0);
        assertEq(wheel.storedActive(), 777);
        assertEq(wheel.effectiveActive(), 777);
        assertEq(wheel.slot(uint8(generation % 32)).generation, 0);

        vm.warp(generation + 1);
        (uint256 amountAfter, uint256 bucketsAfter) = wheel.checkpoint();
        assertEq(amountAfter, 0);
        assertEq(bucketsAfter, 0);
        assertEq(wheel.storedActive(), 777);
    }

    function test_processingFreezesAccumulatorInputsAtTheActivationBoundary() public {
        uint64 generation = wheel.schedule(500, 2);
        wheel.setAccumulators(123e27, 456e27);
        vm.warp(generation);

        vm.expectEmit(true, true, false, true, address(wheel));
        emit ActivationBucketProcessed(MARKET_ID, generation, 500, 123e27, 456e27, 2);
        wheel.checkpoint();

        ActivationSnapshot memory snapshot = wheel.snapshot(generation);
        assertEq(snapshot.quoteAccumulator, 123e27);
        assertEq(snapshot.memeAccumulator, 456e27);
        assertEq(snapshot.refs, 2);
        assertTrue(snapshot.processed);
    }

    function test_sameSecondLargeUserCountUsesOneAggregatedBucketWithoutUserArray() public {
        uint64 generation = wheel.nextGeneration();
        for (uint256 i; i < 256; ++i) {
            wheel.rawSchedule(generation, i + 1, 1);
        }

        ActivationSlot memory slot = wheel.slot(uint8(generation % 32));
        assertEq(slot.amount, 32_896);
        assertEq(slot.refs, 256);
        assertEq(wheel.pending(), 32_896);
    }

    function test_distinctGenerationCollisionRevertsWithoutOverwritingTheSlot() public {
        uint64 requestedGeneration = wheel.nextGeneration();
        uint8 slotIndex = uint8(requestedGeneration % 32);
        uint64 existingGeneration = requestedGeneration + 32;
        wheel.injectSlot(slotIndex, existingGeneration, 900, 4);

        vm.expectRevert(
            abi.encodeWithSelector(
                MemeStockGaugeActivationWheel.ActivationSlotCollision.selector,
                slotIndex,
                existingGeneration,
                requestedGeneration
            )
        );
        wheel.rawSchedule(requestedGeneration, 100, 1);

        ActivationSlot memory slot = wheel.slot(slotIndex);
        assertEq(slot.generation, existingGeneration);
        assertEq(slot.amount, 900);
        assertEq(slot.refs, 4);
        assertEq(wheel.pending(), 900);
    }

    function test_unscheduleSubtractsExactAggregateAndClearsOnlyAtZeroRefs() public {
        uint64 generation = wheel.nextGeneration();
        wheel.rawSchedule(generation, 100, 1);
        wheel.rawSchedule(generation, 250, 1);

        wheel.unschedule(generation, 100, 1);
        ActivationSlot memory remaining = wheel.slot(uint8(generation % 32));
        assertEq(remaining.generation, generation);
        assertEq(remaining.amount, 250);
        assertEq(remaining.refs, 1);
        assertEq(wheel.pending(), 250);

        wheel.unschedule(generation, 250, 1);
        ActivationSlot memory cleared = wheel.slot(uint8(generation % 32));
        assertEq(cleared.generation, 0);
        assertEq(cleared.amount, 0);
        assertEq(cleared.refs, 0);
        assertEq(wheel.pending(), 0);
    }

    function test_unscheduleRejectsMissingOverdrawAndBrokenAmountRefPairAtomically() public {
        uint64 generation = wheel.nextGeneration();
        wheel.rawSchedule(generation, 100, 2);

        vm.expectRevert(
            abi.encodeWithSelector(MemeStockGaugeActivationWheel.PendingGenerationNotFound.selector, generation + 1)
        );
        wheel.unschedule(generation + 1, 1, 1);
        vm.expectRevert(
            abi.encodeWithSelector(MemeStockGaugeActivationWheel.PendingGenerationNotFound.selector, generation)
        );
        wheel.unschedule(generation, 101, 1);
        vm.expectRevert(
            abi.encodeWithSelector(
                MemeStockGaugeActivationWheel.InvalidActivationSlotState.selector,
                uint8(generation % 32),
                generation,
                0,
                1
            )
        );
        wheel.unschedule(generation, 100, 1);

        ActivationSlot memory slot = wheel.slot(uint8(generation % 32));
        assertEq(slot.amount, 100);
        assertEq(slot.refs, 2);
        assertEq(wheel.pending(), 100);
    }

    function test_fullWheelCheckpointScansAllSlotsAndProcessesOnlyMatureGenerations() public {
        uint256 total;
        uint256 firstHalf;
        uint64 start = uint64(block.timestamp + 1);
        for (uint8 i; i < 32; ++i) {
            uint64 generation = start + i;
            uint256 amount = uint256(i) + 1;
            wheel.injectSlot(uint8(generation % 32), generation, amount, 1);
            total += amount;
            if (i < 16) firstHalf += amount;
        }
        assertEq(total, 528);
        assertEq(wheel.pending(), total);

        vm.warp(start + 15);
        (uint256 activatedFirst, uint256 bucketsFirst) = wheel.checkpoint();
        assertEq(activatedFirst, firstHalf);
        assertEq(bucketsFirst, 16);
        assertEq(wheel.storedActive(), firstHalf);
        assertEq(wheel.pending(), total - firstHalf);

        vm.warp(start + 31);
        (uint256 activatedSecond, uint256 bucketsSecond) = wheel.checkpoint();
        assertEq(activatedSecond, total - firstHalf);
        assertEq(bucketsSecond, 16);
        assertEq(wheel.storedActive(), total);
        assertEq(wheel.pending(), 0);
        assertEq(wheel.snapshotWrites(), 32);
    }

    function test_slotReuseUsesAbsoluteGenerationAndDoesNotOverwriteOldSnapshot() public {
        uint64 firstGeneration = wheel.schedule(100, 1);
        vm.warp(firstGeneration);
        wheel.checkpoint();
        ActivationSnapshot memory first = wheel.snapshot(firstGeneration);

        vm.warp(firstGeneration + 2);
        uint64 secondGeneration = wheel.schedule(200, 1);
        assertEq(secondGeneration, firstGeneration + 32);
        assertEq(uint8(secondGeneration % 32), uint8(firstGeneration % 32));
        vm.warp(secondGeneration);
        wheel.checkpoint();

        ActivationSnapshot memory retained = wheel.snapshot(firstGeneration);
        ActivationSnapshot memory second = wheel.snapshot(secondGeneration);
        assertEq(retained.refs, first.refs);
        assertTrue(retained.processed);
        assertEq(second.refs, 1);
        assertTrue(second.processed);
    }

    function test_snapshotHookFailureRollsBackSlotTotalsAndProcessedCount() public {
        uint64 generation = wheel.schedule(100, 1);
        wheel.setFailSnapshotWrite(true);
        vm.warp(generation);
        vm.expectRevert(MemeStockGaugeActivationWheelHarness.InjectedSnapshotFailure.selector);
        wheel.checkpoint();

        ActivationSlot memory slot = wheel.slot(uint8(generation % 32));
        assertEq(slot.generation, generation);
        assertEq(slot.amount, 100);
        assertEq(slot.refs, 1);
        assertEq(wheel.pending(), 100);
        assertEq(wheel.storedActive(), 0);
        assertEq(wheel.snapshotWrites(), 0);
    }

    function test_oneYearIdleCheckpointHasConstantWheelBoundAndNoHistoricalTimeLoop() public {
        uint64 nearGeneration = wheel.schedule(1, 1);
        vm.warp(nearGeneration);
        uint256 nearBefore = gasleft();
        wheel.checkpoint();
        uint256 nearGas = nearBefore - gasleft();

        MemeStockGaugeActivationWheelHarness longIdleWheel = new MemeStockGaugeActivationWheelHarness();
        uint64 longGeneration = longIdleWheel.schedule(1, 1);
        vm.warp(uint256(longGeneration) + 365 days);
        uint256 longBefore = gasleft();
        longIdleWheel.checkpoint();
        uint256 longGas = longBefore - gasleft();

        emit log_named_uint("near-checkpoint-gas", nearGas);
        emit log_named_uint("one-year-idle-checkpoint-gas", longGas);
        assertLe(longGas, nearGas + 2_000);
        assertEq(longIdleWheel.storedActive(), 1);
        assertEq(longIdleWheel.snapshotWrites(), 1);
    }

    function test_fullWheelWorstCaseGasIsBoundedAndReferenceCountIndependent() public {
        MemeStockGaugeActivationWheelHarness fullWheel = new MemeStockGaugeActivationWheelHarness();
        uint64 firstGeneration = uint64(block.timestamp + 1);
        for (uint8 i; i < 32; ++i) {
            uint64 generation = firstGeneration + i;
            fullWheel.injectSlot(uint8(generation % 32), generation, uint256(i) + 1, 1);
        }
        vm.warp(firstGeneration + 31);
        uint256 fullBefore = gasleft();
        (uint256 activated, uint256 processed) = fullWheel.checkpoint();
        uint256 fullWheelGas = fullBefore - gasleft();

        MemeStockGaugeActivationWheelHarness oneRef = new MemeStockGaugeActivationWheelHarness();
        MemeStockGaugeActivationWheelHarness manyRefs = new MemeStockGaugeActivationWheelHarness();
        uint64 comparisonGeneration = oneRef.schedule(1, 1);
        for (uint256 i; i < 256; ++i) {
            manyRefs.schedule(1, 1);
        }
        vm.warp(comparisonGeneration);
        uint256 oneBefore = gasleft();
        oneRef.checkpoint();
        uint256 oneRefGas = oneBefore - gasleft();
        uint256 manyBefore = gasleft();
        manyRefs.checkpoint();
        uint256 manyRefsGas = manyBefore - gasleft();

        emit log_named_uint("full-wheel-checkpoint-gas", fullWheelGas);
        emit log_named_uint("one-ref-checkpoint-gas", oneRefGas);
        emit log_named_uint("256-refs-checkpoint-gas", manyRefsGas);
        assertEq(activated, 528);
        assertEq(processed, 32);
        assertLt(fullWheelGas, 2_000_000);
        assertLe(manyRefsGas, oneRefGas + 500);
    }

    function test_normalSchedulingCheckpointsMatureSlotsBeforeThirtyTwoCanAccumulate() public {
        MemeStockGaugeActivationWheelHarness normallyScheduled = new MemeStockGaugeActivationWheelHarness();
        uint64 lastGeneration;
        for (uint8 i; i < 32; ++i) {
            lastGeneration = normallyScheduled.schedule(uint256(i) + 1, 1);
            if (i != 31) vm.warp(block.timestamp + 1);
        }

        assertEq(normallyScheduled.storedActive(), 3);
        assertEq(normallyScheduled.pending(), 525);
        vm.warp(lastGeneration);
        uint256 checkpointBefore = gasleft();
        (uint256 activated, uint256 processed) = normallyScheduled.checkpoint();
        uint256 checkpointGas = checkpointBefore - gasleft();

        emit log_named_uint("normal-schedule-30-slot-checkpoint-gas", checkpointGas);
        assertEq(activated, 525);
        assertEq(processed, 30);
        assertEq(normallyScheduled.storedActive(), 528);
        assertEq(normallyScheduled.pending(), 0);
        assertLt(checkpointGas, 2_000_000);
    }

    function test_invalidGenerationBucketIndexAndTimestampOverflowFailClosed() public {
        uint64 expectedGeneration = wheel.nextGeneration();
        vm.expectRevert(
            abi.encodeWithSelector(
                MemeStockGaugeActivationWheel.InvalidActivationGeneration.selector,
                expectedGeneration + 1,
                expectedGeneration
            )
        );
        wheel.rawSchedule(expectedGeneration + 1, 1, 1);
        vm.expectRevert(abi.encodeWithSelector(MemeStockGaugeActivationWheel.InvalidActivationBucket.selector, 0, 1));
        wheel.rawSchedule(expectedGeneration, 0, 1);
        vm.expectRevert(
            abi.encodeWithSelector(MemeStockGaugeActivationWheel.InvalidActivationSlotIndex.selector, uint8(32))
        );
        wheel.slot(32);

        vm.warp(uint256(type(uint64).max) - 30 seconds + 1);
        vm.expectRevert(
            abi.encodeWithSelector(MemeStockGaugeActivationWheel.ActivationTimestampOverflow.selector, block.timestamp)
        );
        wheel.nextGeneration();
    }

    function test_effectiveViewProjectsMatureBucketsWithoutMutatingStoredTotals() public {
        uint64 generation = wheel.schedule(321, 1);
        vm.warp(generation);
        assertEq(wheel.effectiveActive(), 321);
        assertEq(wheel.effectiveActive(), 321);
        assertEq(wheel.storedActive(), 0);
        assertEq(wheel.pending(), 321);
        assertEq(wheel.snapshotWrites(), 0);
    }

    function testFuzz_sameGenerationAggregationConservesAmountAndRefs(
        uint128 firstAmount,
        uint128 secondAmount,
        uint64 firstRefs,
        uint64 secondRefs
    ) public {
        firstAmount = uint128(bound(firstAmount, 1, type(uint128).max));
        secondAmount = uint128(bound(secondAmount, 1, type(uint128).max));
        firstRefs = uint64(bound(firstRefs, 1, type(uint64).max));
        secondRefs = uint64(bound(secondRefs, 1, type(uint64).max));
        uint64 generation = wheel.nextGeneration();

        wheel.rawSchedule(generation, firstAmount, firstRefs);
        wheel.rawSchedule(generation, secondAmount, secondRefs);

        ActivationSlot memory slot = wheel.slot(uint8(generation % 32));
        assertEq(slot.amount, uint256(firstAmount) + secondAmount);
        assertEq(slot.refs, uint256(firstRefs) + secondRefs);
        assertEq(wheel.pending(), uint256(firstAmount) + secondAmount);
    }
}
