// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {stdError} from "forge-std/StdError.sol";

import {ActivationSnapshot} from "../../../src/v2/interfaces/IV2Protocol.sol";
import {MemeStockGaugeActivationSnapshots} from "../../../src/v2/shared/MemeStockGaugeActivationSnapshots.sol";
import {MemeStockGaugeActivationWheel} from "../../../src/v2/shared/MemeStockGaugeActivationWheel.sol";

contract MemeStockGaugeActivationSnapshotsHarness is MemeStockGaugeActivationSnapshots {
    bytes32 public constant MARKET_ID = keccak256("snapshot-market");

    uint256 public quoteAccumulator;
    uint256 public memeAccumulator;
    uint256 public settlementCalls;
    bool public failSettlement;

    error InjectedSettlementFailure();
    error PositionAlreadyPending(address user);

    function setAccumulators(uint256 quoteAccumulator_, uint256 memeAccumulator_) external {
        quoteAccumulator = quoteAccumulator_;
        memeAccumulator = memeAccumulator_;
    }

    function setFailSettlement(bool fail) external {
        failSettlement = fail;
    }

    function scheduleFor(address user, uint256 amount) external returns (uint64 generation) {
        _checkpointActivations(MARKET_ID, quoteAccumulator, memeAccumulator);
        GaugePosition storage position = _gaugePositions[user];
        if (position.pendingAmount != 0 || position.pendingGeneration != 0) {
            revert PositionAlreadyPending(user);
        }
        generation = _nextActivationGeneration();
        _scheduleActivation(generation, amount, 1);
        position.pendingAmount = amount;
        position.pendingGeneration = generation;
    }

    function checkpoint() external returns (uint256 activatedAmount, uint256 processedBuckets) {
        return _checkpointActivations(MARKET_ID, quoteAccumulator, memeAccumulator);
    }

    function materialize(address user) external returns (uint256 amount, uint64 generation, bool materialized) {
        return _materializePending(user, MARKET_ID, quoteAccumulator, memeAccumulator);
    }

    function setPosition(
        address user,
        uint256 activeAmount,
        uint256 pendingAmount,
        uint64 pendingGeneration,
        uint64 unlockAt,
        uint256 quotePaid,
        uint256 memePaid
    ) external {
        GaugePosition storage position = _gaugePositions[user];
        position.activeAmount = activeAmount;
        position.pendingAmount = pendingAmount;
        position.pendingGeneration = pendingGeneration;
        position.unlockAt = unlockAt;
        position.rewards[0].accumulatorPaid = quotePaid;
        position.rewards[1].accumulatorPaid = memePaid;
    }

    function injectSnapshot(
        uint64 generation,
        uint256 quoteAccumulator_,
        uint256 memeAccumulator_,
        uint256 refs,
        bool processed
    ) external {
        _activationSnapshots[generation] = ActivationSnapshot(quoteAccumulator_, memeAccumulator_, refs, processed);
    }

    function snapshot(uint64 generation) external view returns (ActivationSnapshot memory) {
        return _activationSnapshot(generation);
    }

    function positionAmounts(address user)
        external
        view
        returns (uint256 activeAmount, uint256 pendingAmount, uint64 pendingGeneration, uint64 unlockAt)
    {
        GaugePosition storage position = _gaugePositions[user];
        return (position.activeAmount, position.pendingAmount, position.pendingGeneration, position.unlockAt);
    }

    function reward(address user, uint8 index)
        external
        view
        returns (uint256 paid, uint256 pendingFee, uint256 remainder)
    {
        GaugeUserReward storage userReward = _gaugePositions[user].rewards[index];
        return (userReward.accumulatorPaid, userReward.pendingFee, userReward.userRemainder);
    }

    function effectiveUserActive(address user) external view returns (uint256) {
        return _effectiveUserActiveStock(user);
    }

    function storedActive() external view returns (uint256) {
        return _storedTotalActiveStock;
    }

    function pendingTotal() external view returns (uint256) {
        return _totalPendingStock;
    }

    function slotGeneration(uint8 slotIndex) external view returns (uint64) {
        return _activationSlot(slotIndex).generation;
    }

    function _settleMaterializingPosition(
        address,
        GaugePosition storage position,
        ActivationSnapshot memory activationSnapshot_,
        uint256 currentQuoteAccumulator,
        uint256 currentMemeAccumulator
    ) internal override {
        if (failSettlement) revert InjectedSettlementFailure();
        ++settlementCalls;

        GaugeUserReward storage quoteReward = position.rewards[0];
        quoteReward.pendingFee += position.activeAmount * (currentQuoteAccumulator - quoteReward.accumulatorPaid)
        + position.pendingAmount * (currentQuoteAccumulator - activationSnapshot_.quoteAccumulator);
        quoteReward.accumulatorPaid = currentQuoteAccumulator;

        GaugeUserReward storage memeReward = position.rewards[1];
        memeReward.pendingFee += position.activeAmount * (currentMemeAccumulator - memeReward.accumulatorPaid)
        + position.pendingAmount * (currentMemeAccumulator - activationSnapshot_.memeAccumulator);
        memeReward.accumulatorPaid = currentMemeAccumulator;
    }
}

contract MemeStockGaugeActivationSnapshotsTest is Test {
    address internal constant ALICE = address(0xA11CE);
    address internal constant BOB = address(0xB0B);
    bytes32 internal constant MARKET_ID = keccak256("snapshot-market");

    MemeStockGaugeActivationSnapshotsHarness internal gauge;

    event PendingMaterialized(
        address indexed user, bytes32 indexed marketId, uint64 indexed generation, uint256 amount
    );

    function setUp() public {
        gauge = new MemeStockGaugeActivationSnapshotsHarness();
        vm.warp(1_000_000);
    }

    function test_checkpointPersistsAbsoluteSnapshotWithoutWalkingUsers() public {
        uint64 generation = gauge.scheduleFor(ALICE, 400);
        gauge.setAccumulators(17e27, 29e27);
        vm.warp(generation);

        gauge.checkpoint();

        ActivationSnapshot memory snapshot = gauge.snapshot(generation);
        assertEq(snapshot.quoteAccumulator, 17e27);
        assertEq(snapshot.memeAccumulator, 29e27);
        assertEq(snapshot.refs, 1);
        assertTrue(snapshot.processed);
        (uint256 active, uint256 pending, uint64 pendingGeneration,) = gauge.positionAmounts(ALICE);
        assertEq(active, 0);
        assertEq(pending, 400);
        assertEq(pendingGeneration, generation);
        assertEq(gauge.storedActive(), 400);
        assertEq(gauge.effectiveUserActive(ALICE), 400);
        assertEq(gauge.settlementCalls(), 0);
    }

    function test_materializationSettlesActiveAndPendingFromDistinctIndicesThenMerges() public {
        gauge.setPosition(ALICE, 10, 0, 0, 86_400, 2, 5);
        uint64 generation = gauge.scheduleFor(ALICE, 20);
        gauge.setAccumulators(7, 11);
        vm.warp(generation);
        gauge.checkpoint();
        gauge.setAccumulators(13, 17);

        vm.expectEmit(true, true, true, true, address(gauge));
        emit PendingMaterialized(ALICE, MARKET_ID, generation, 20);
        (uint256 amount, uint64 materializedGeneration, bool materialized) = gauge.materialize(ALICE);

        assertEq(amount, 20);
        assertEq(materializedGeneration, generation);
        assertTrue(materialized);
        (uint256 active, uint256 pending, uint64 pendingGeneration, uint64 unlockAt) = gauge.positionAmounts(ALICE);
        assertEq(active, 30);
        assertEq(pending, 0);
        assertEq(pendingGeneration, 0);
        assertEq(unlockAt, 86_400);
        (uint256 quotePaid, uint256 quoteFee,) = gauge.reward(ALICE, 0);
        (uint256 memePaid, uint256 memeFee,) = gauge.reward(ALICE, 1);
        assertEq(quotePaid, 13);
        assertEq(quoteFee, 230);
        assertEq(memePaid, 17);
        assertEq(memeFee, 240);
        assertFalse(gauge.snapshot(generation).processed);
    }

    function test_sharedSnapshotRefcountDecrementsAndDeletesOnlyAfterLastUser() public {
        uint64 generation = gauge.scheduleFor(ALICE, 100);
        assertEq(gauge.scheduleFor(BOB, 200), generation);
        gauge.setAccumulators(101, 202);
        vm.warp(generation);
        gauge.checkpoint();
        assertEq(gauge.snapshot(generation).refs, 2);

        gauge.materialize(ALICE);
        ActivationSnapshot memory retained = gauge.snapshot(generation);
        assertTrue(retained.processed);
        assertEq(retained.quoteAccumulator, 101);
        assertEq(retained.memeAccumulator, 202);
        assertEq(retained.refs, 1);

        gauge.materialize(BOB);
        ActivationSnapshot memory removed = gauge.snapshot(generation);
        assertFalse(removed.processed);
        assertEq(removed.refs, 0);
        assertEq(gauge.effectiveUserActive(ALICE), 100);
        assertEq(gauge.effectiveUserActive(BOB), 200);
    }

    function test_ringSlotReuseCannotOverwriteAnUnmaterializedAbsoluteSnapshot() public {
        uint64 firstGeneration = gauge.scheduleFor(ALICE, 100);
        gauge.setAccumulators(11, 22);
        vm.warp(firstGeneration);
        gauge.checkpoint();

        vm.warp(firstGeneration + 2);
        uint64 secondGeneration = gauge.scheduleFor(BOB, 200);
        assertEq(secondGeneration, firstGeneration + 32);
        assertEq(uint8(secondGeneration % 32), uint8(firstGeneration % 32));
        ActivationSnapshot memory firstBefore = gauge.snapshot(firstGeneration);

        gauge.setAccumulators(33, 44);
        vm.warp(secondGeneration);
        gauge.checkpoint();

        ActivationSnapshot memory firstAfter = gauge.snapshot(firstGeneration);
        ActivationSnapshot memory second = gauge.snapshot(secondGeneration);
        assertEq(firstAfter.quoteAccumulator, firstBefore.quoteAccumulator);
        assertEq(firstAfter.memeAccumulator, firstBefore.memeAccumulator);
        assertEq(firstAfter.refs, 1);
        assertTrue(firstAfter.processed);
        assertEq(second.quoteAccumulator, 33);
        assertEq(second.memeAccumulator, 44);
        assertEq(second.refs, 1);
        assertTrue(second.processed);

        gauge.materialize(BOB);
        assertTrue(gauge.snapshot(firstGeneration).processed);
        assertFalse(gauge.snapshot(secondGeneration).processed);
        gauge.materialize(ALICE);
        assertFalse(gauge.snapshot(firstGeneration).processed);
    }

    function test_futurePendingDoesNotMaterializeOrConsumeItsWheelReference() public {
        uint64 generation = gauge.scheduleFor(ALICE, 55);
        (uint256 amount, uint64 returnedGeneration, bool materialized) = gauge.materialize(ALICE);
        assertEq(amount, 55);
        assertEq(returnedGeneration, generation);
        assertFalse(materialized);
        (, uint256 pending, uint64 pendingGeneration,) = gauge.positionAmounts(ALICE);
        assertEq(pending, 55);
        assertEq(pendingGeneration, generation);
        assertEq(gauge.pendingTotal(), 55);
        assertEq(gauge.slotGeneration(uint8(generation % 32)), generation);
    }

    function test_maturePendingWithoutProcessedSnapshotFailsClosed() public {
        uint64 generation = uint64(block.timestamp - 1);
        gauge.setPosition(ALICE, 0, 10, generation, 0, 0, 0);
        vm.expectRevert(
            abi.encodeWithSelector(MemeStockGaugeActivationWheel.PendingGenerationNotFound.selector, generation)
        );
        gauge.materialize(ALICE);
    }

    function test_processedSnapshotWithZeroRefsFailsClosedWithoutMovingPending() public {
        uint64 generation = uint64(block.timestamp - 1);
        gauge.setPosition(ALICE, 3, 10, generation, 0, 0, 0);
        gauge.injectSnapshot(generation, 4, 5, 0, true);

        vm.expectRevert(
            abi.encodeWithSelector(
                MemeStockGaugeActivationSnapshots.InvalidActivationSnapshot.selector, generation, 0, true
            )
        );
        gauge.materialize(ALICE);

        (uint256 active, uint256 pending, uint64 pendingGeneration,) = gauge.positionAmounts(ALICE);
        assertEq(active, 3);
        assertEq(pending, 10);
        assertEq(pendingGeneration, generation);
        assertTrue(gauge.snapshot(generation).processed);
        assertEq(gauge.settlementCalls(), 0);
    }

    function test_inconsistentPositionEncodingFailsBeforeSettlement() public {
        gauge.setPosition(ALICE, 0, 0, 7, 0, 0, 0);
        vm.expectRevert(
            abi.encodeWithSelector(MemeStockGaugeActivationSnapshots.InvalidGaugePosition.selector, ALICE, 0, 7)
        );
        gauge.materialize(ALICE);

        gauge.setPosition(ALICE, 0, 9, 0, 0, 0, 0);
        vm.expectRevert(
            abi.encodeWithSelector(MemeStockGaugeActivationSnapshots.InvalidGaugePosition.selector, ALICE, 9, 0)
        );
        gauge.materialize(ALICE);
        assertEq(gauge.settlementCalls(), 0);
    }

    function test_duplicateAbsoluteSnapshotRevertsCheckpointAndRollsBackTotals() public {
        uint64 generation = gauge.scheduleFor(ALICE, 80);
        gauge.injectSnapshot(generation, 1, 2, 7, true);
        vm.warp(generation);
        vm.expectRevert(
            abi.encodeWithSelector(
                MemeStockGaugeActivationSnapshots.ActivationSnapshotAlreadyProcessed.selector, generation
            )
        );
        gauge.checkpoint();

        assertEq(gauge.pendingTotal(), 80);
        assertEq(gauge.storedActive(), 0);
        assertEq(gauge.slotGeneration(uint8(generation % 32)), generation);
        assertEq(gauge.snapshot(generation).refs, 7);
    }

    function test_settlementFailureRollsBackPositionAndSnapshotReference() public {
        uint64 generation = gauge.scheduleFor(ALICE, 90);
        vm.warp(generation);
        gauge.checkpoint();
        gauge.setFailSettlement(true);

        vm.expectRevert(MemeStockGaugeActivationSnapshotsHarness.InjectedSettlementFailure.selector);
        gauge.materialize(ALICE);

        (uint256 active, uint256 pending, uint64 pendingGeneration,) = gauge.positionAmounts(ALICE);
        assertEq(active, 0);
        assertEq(pending, 90);
        assertEq(pendingGeneration, generation);
        assertEq(gauge.snapshot(generation).refs, 1);
        assertEq(gauge.settlementCalls(), 0);
    }

    function test_materializationCostDoesNotDependOnAbandonedHistoricalSnapshots() public {
        MemeStockGaugeActivationSnapshotsHarness clean = new MemeStockGaugeActivationSnapshotsHarness();
        uint64 generation = uint64(block.timestamp - 1);
        clean.setPosition(ALICE, 0, 1, generation, 0, 0, 0);
        clean.injectSnapshot(generation, 0, 0, 1, true);

        gauge.setPosition(ALICE, 0, 1, generation, 0, 0, 0);
        gauge.injectSnapshot(generation, 0, 0, 1, true);
        for (uint64 i = 1; i <= 256; ++i) {
            gauge.injectSnapshot(generation - i, i, i, 1, true);
        }

        uint256 cleanBefore = gasleft();
        clean.materialize(ALICE);
        uint256 cleanGas = cleanBefore - gasleft();
        uint256 historyBefore = gasleft();
        gauge.materialize(ALICE);
        uint256 historyGas = historyBefore - gasleft();

        emit log_named_uint("clean-materialize-gas", cleanGas);
        emit log_named_uint("256-history-materialize-gas", historyGas);
        assertLe(historyGas, cleanGas + 500);
    }

    function test_repeatedMaterializationIsANoOpAndDoesNotTouchDeletedSnapshot() public {
        uint64 generation = gauge.scheduleFor(ALICE, 12);
        vm.warp(generation);
        gauge.checkpoint();
        gauge.materialize(ALICE);

        (uint256 amount, uint64 returnedGeneration, bool materialized) = gauge.materialize(ALICE);
        assertEq(amount, 0);
        assertEq(returnedGeneration, 0);
        assertFalse(materialized);
        assertEq(gauge.settlementCalls(), 1);
        assertFalse(gauge.snapshot(generation).processed);
    }

    function test_effectiveUserWeightChangesOnlyAfterBucketIsProcessed() public {
        gauge.setPosition(ALICE, 40, 0, 0, 0, 0, 0);
        uint64 generation = gauge.scheduleFor(ALICE, 60);
        assertEq(gauge.effectiveUserActive(ALICE), 40);
        vm.warp(generation);
        assertEq(gauge.effectiveUserActive(ALICE), 40);
        gauge.checkpoint();
        assertEq(gauge.effectiveUserActive(ALICE), 100);
        gauge.materialize(ALICE);
        assertEq(gauge.effectiveUserActive(ALICE), 100);
    }

    function test_activePlusPendingOverflowRollsBackRewardSettlementAndReference() public {
        uint64 generation = uint64(block.timestamp - 1);
        gauge.setPosition(ALICE, type(uint256).max, 1, generation, 0, 0, 0);
        gauge.injectSnapshot(generation, 0, 0, 1, true);

        vm.expectRevert(stdError.arithmeticError);
        gauge.materialize(ALICE);

        (uint256 active, uint256 pending, uint64 pendingGeneration,) = gauge.positionAmounts(ALICE);
        assertEq(active, type(uint256).max);
        assertEq(pending, 1);
        assertEq(pendingGeneration, generation);
        assertEq(gauge.snapshot(generation).refs, 1);
        assertEq(gauge.settlementCalls(), 0);
    }

    function testFuzz_sameGenerationUsersMaterializeWithoutScanningPeers(uint8 userCount) public {
        userCount = uint8(bound(userCount, 1, 64));
        uint64 generation;
        uint256 total;
        for (uint256 i; i < userCount; ++i) {
            address user = address(uint160(i + 1));
            uint256 amount = i + 1;
            uint64 scheduled = gauge.scheduleFor(user, amount);
            if (i == 0) generation = scheduled;
            else assertEq(scheduled, generation);
            total += amount;
        }
        vm.warp(generation);
        gauge.checkpoint();
        assertEq(gauge.snapshot(generation).refs, userCount);

        for (uint256 i; i < userCount; ++i) {
            address user = address(uint160(i + 1));
            gauge.materialize(user);
            assertEq(gauge.effectiveUserActive(user), i + 1);
        }
        assertFalse(gauge.snapshot(generation).processed);
        assertEq(gauge.storedActive(), total);
        assertEq(gauge.settlementCalls(), userCount);
    }
}
