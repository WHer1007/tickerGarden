// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {stdError} from "forge-std/StdError.sol";

import {ActivationSlot, ActivationSnapshot} from "../../../src/v2/interfaces/IV2Protocol.sol";
import {MemeStockGaugeActivationSnapshots} from "../../../src/v2/shared/MemeStockGaugeActivationSnapshots.sol";
import {MemeStockGaugeLockedPositions} from "../../../src/v2/shared/MemeStockGaugeLockedPositions.sol";

contract MemeStockGaugeLockedPositionsHarness is MemeStockGaugeLockedPositions {
    bytes32 public constant MARKET_ID = keccak256("locked-market");

    uint256 public quoteAccumulator;
    uint256 public memeAccumulator;
    uint256 public sequence;
    uint256 public materializeSequence;
    uint256 public removeSequence;
    uint256 public lastRemovalSettlementWeight;
    bool public failMaterializationSettlement;
    bool public failRemovalSettlement;

    error InjectedMaterializationFailure();
    error InjectedRemovalFailure();

    function setAccumulators(uint256 quoteAccumulator_, uint256 memeAccumulator_) external {
        quoteAccumulator = quoteAccumulator_;
        memeAccumulator = memeAccumulator_;
    }

    function setFailures(bool materializationFailure, bool removalFailure) external {
        failMaterializationSettlement = materializationFailure;
        failRemovalSettlement = removalFailure;
    }

    function addPending(address user, uint256 amount, uint64 generation, uint64 unlockAt) external {
        _addPending(user, amount, generation, unlockAt, MARKET_ID, quoteAccumulator, memeAccumulator);
    }

    function removeAllocation(address user, uint256 amount) external returns (uint256) {
        return _removeAllocation(user, amount, MARKET_ID, quoteAccumulator, memeAccumulator);
    }

    function expectedTimes() external view returns (uint64 generation, uint64 unlockAt) {
        return (_nextActivationGeneration(), _nextPositionUnlockAt());
    }

    function position(address user)
        external
        view
        returns (uint256 activeAmount, uint256 pendingAmount, uint64 pendingGeneration, uint64 unlockAt)
    {
        GaugePosition storage stored = _gaugePositions[user];
        return (stored.activeAmount, stored.pendingAmount, stored.pendingGeneration, stored.unlockAt);
    }

    function reward(address user, uint8 index)
        external
        view
        returns (uint256 paid, uint256 pendingFee, uint256 remainder)
    {
        GaugeUserReward storage stored = _gaugePositions[user].rewards[index];
        return (stored.accumulatorPaid, stored.pendingFee, stored.userRemainder);
    }

    function seedActive(address user, uint256 amount, uint64 unlockAt, uint256 totalActive) external {
        GaugePosition storage stored = _gaugePositions[user];
        stored.activeAmount = amount;
        stored.unlockAt = unlockAt;
        _storedTotalActiveStock = totalActive;
    }

    function seedPending(address user, uint256 amount, uint64 generation, uint64 unlockAt) external {
        GaugePosition storage stored = _gaugePositions[user];
        stored.pendingAmount = amount;
        stored.pendingGeneration = generation;
        stored.unlockAt = unlockAt;
        uint8 slotIndex = uint8(generation % ACTIVATION_WHEEL_SIZE);
        _activationWheel[slotIndex] = ActivationSlot(generation, amount, 1);
        _totalPendingStock = amount;
    }

    function seedReward(address user, uint8 index, uint256 paid, uint256 pendingFee, uint256 remainder) external {
        _gaugePositions[user].rewards[index] = GaugeUserReward(paid, pendingFee, remainder);
    }

    function injectSnapshot(uint64 generation, uint256 quoteAccumulator_, uint256 memeAccumulator_, uint256 refs)
        external
    {
        _activationSnapshots[generation] = ActivationSnapshot(quoteAccumulator_, memeAccumulator_, refs, true);
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

    function _settleMaterializingPosition(
        address,
        GaugePosition storage position_,
        ActivationSnapshot memory,
        uint256 currentQuoteAccumulator,
        uint256 currentMemeAccumulator
    ) internal override {
        if (failMaterializationSettlement) revert InjectedMaterializationFailure();
        materializeSequence = ++sequence;
        position_.rewards[0].accumulatorPaid = currentQuoteAccumulator;
        position_.rewards[1].accumulatorPaid = currentMemeAccumulator;
    }

    function _settleRemovingPosition(
        address,
        GaugePosition storage position_,
        uint256 currentQuoteAccumulator,
        uint256 currentMemeAccumulator
    ) internal override {
        if (failRemovalSettlement) revert InjectedRemovalFailure();
        removeSequence = ++sequence;
        lastRemovalSettlementWeight = position_.activeAmount;
        position_.rewards[0].accumulatorPaid = currentQuoteAccumulator;
        position_.rewards[1].accumulatorPaid = currentMemeAccumulator;
    }
}

contract MemeStockGaugeLockedPositionsTest is Test {
    address internal constant ALICE = address(0xA11CE);
    address internal constant BOB = address(0xB0B);

    MemeStockGaugeLockedPositionsHarness internal gauge;

    function setUp() public {
        gauge = new MemeStockGaugeLockedPositionsHarness();
        vm.warp(1_000_000);
    }

    function test_unlockMinusOneRevertsAndRollsBackMatureBucketProcessing() public {
        (uint64 generation, uint64 unlockAt) = gauge.expectedTimes();
        gauge.addPending(ALICE, 100, generation, unlockAt);
        vm.warp(unlockAt - 1);

        vm.expectRevert(abi.encodeWithSelector(MemeStockGaugeLockedPositions.PositionLockedUntil.selector, unlockAt));
        gauge.removeAllocation(ALICE, 40);

        (uint256 active, uint256 pending, uint64 pendingGeneration, uint64 storedUnlock) = gauge.position(ALICE);
        assertEq(active, 0);
        assertEq(pending, 100);
        assertEq(pendingGeneration, generation);
        assertEq(storedUnlock, unlockAt);
        assertEq(gauge.storedActive(), 0);
        assertEq(gauge.pendingTotal(), 100);
        assertEq(gauge.slot(uint8(generation % 32)).generation, generation);
        assertFalse(gauge.snapshot(generation).processed);
    }

    function test_exactUnlockMaterializesSettlesFullWeightThenRemovesPartial() public {
        (uint64 generation, uint64 unlockAt) = gauge.expectedTimes();
        gauge.addPending(ALICE, 100, generation, unlockAt);
        gauge.setAccumulators(17, 29);
        vm.warp(unlockAt);

        assertEq(gauge.removeAllocation(ALICE, 40), 60);

        (uint256 active, uint256 pending, uint64 pendingGeneration, uint64 storedUnlock) = gauge.position(ALICE);
        assertEq(active, 60);
        assertEq(pending, 0);
        assertEq(pendingGeneration, 0);
        assertEq(storedUnlock, unlockAt);
        assertEq(gauge.storedActive(), 60);
        assertEq(gauge.pendingTotal(), 0);
        assertFalse(gauge.snapshot(generation).processed);
        assertEq(gauge.materializeSequence(), 1);
        assertEq(gauge.removeSequence(), 2);
        assertEq(gauge.lastRemovalSettlementWeight(), 100);
        (uint256 quotePaid,,) = gauge.reward(ALICE, 0);
        (uint256 memePaid,,) = gauge.reward(ALICE, 1);
        assertEq(quotePaid, 17);
        assertEq(memePaid, 29);
    }

    function test_fullCloseAtUnlockClearsOnlyWeightAndLockButPreservesRewards() public {
        uint64 unlockAt = uint64(block.timestamp);
        gauge.seedActive(ALICE, 75, unlockAt, 75);
        gauge.seedReward(ALICE, 0, 3, 11, 19);
        gauge.seedReward(ALICE, 1, 5, 13, 23);

        assertEq(gauge.removeAllocation(ALICE, 75), 0);

        (uint256 active, uint256 pending, uint64 generation, uint64 storedUnlock) = gauge.position(ALICE);
        assertEq(active, 0);
        assertEq(pending, 0);
        assertEq(generation, 0);
        assertEq(storedUnlock, 0);
        assertEq(gauge.storedActive(), 0);
        (, uint256 quoteFee, uint256 quoteRemainder) = gauge.reward(ALICE, 0);
        (, uint256 memeFee, uint256 memeRemainder) = gauge.reward(ALICE, 1);
        assertEq(quoteFee, 11);
        assertEq(quoteRemainder, 19);
        assertEq(memeFee, 13);
        assertEq(memeRemainder, 23);
    }

    function test_partialRemovalPreservesOriginalWholePositionUnlock() public {
        uint64 unlockAt = uint64(block.timestamp);
        gauge.seedActive(ALICE, 90, unlockAt, 90);
        gauge.removeAllocation(ALICE, 30);

        (uint256 active,,, uint64 storedUnlock) = gauge.position(ALICE);
        assertEq(active, 60);
        assertEq(storedUnlock, unlockAt);
        assertEq(gauge.lastRemovalSettlementWeight(), 90);
    }

    function test_futurePendingCannotBeRemovedEvenWithCorruptExpiredLock() public {
        uint64 generation = uint64(block.timestamp + 10);
        uint64 unlockAt = uint64(block.timestamp - 1);
        gauge.seedPending(ALICE, 50, generation, unlockAt);

        vm.expectRevert(
            abi.encodeWithSelector(
                MemeStockGaugeLockedPositions.PendingPositionNotMaterialized.selector, ALICE, 50, generation
            )
        );
        gauge.removeAllocation(ALICE, 10);

        (, uint256 pending, uint64 storedGeneration, uint64 storedUnlock) = gauge.position(ALICE);
        assertEq(pending, 50);
        assertEq(storedGeneration, generation);
        assertEq(storedUnlock, unlockAt);
        assertEq(gauge.pendingTotal(), 50);
    }

    function test_zeroUserZeroAmountEmptyOverdrawAndZeroLockFailClosed() public {
        vm.expectRevert(abi.encodeWithSelector(MemeStockGaugeLockedPositions.InvalidRemovalUser.selector, address(0)));
        gauge.removeAllocation(address(0), 1);
        vm.expectRevert(abi.encodeWithSelector(MemeStockGaugeLockedPositions.InvalidRemovalAmount.selector, 0));
        gauge.removeAllocation(ALICE, 0);
        vm.expectRevert(abi.encodeWithSelector(MemeStockGaugeLockedPositions.NoActiveAllocation.selector, ALICE));
        gauge.removeAllocation(ALICE, 1);

        gauge.seedActive(ALICE, 10, uint64(block.timestamp), 10);
        vm.expectRevert(
            abi.encodeWithSelector(MemeStockGaugeLockedPositions.InsufficientActiveAllocation.selector, 11, 10)
        );
        gauge.removeAllocation(ALICE, 11);
        assertEq(gauge.removeSequence(), 0);

        gauge.seedActive(ALICE, 10, 0, 10);
        vm.expectRevert(abi.encodeWithSelector(MemeStockGaugeLockedPositions.InvalidPositionLock.selector, ALICE, 0));
        gauge.removeAllocation(ALICE, 1);
    }

    function test_sharedProcessedBucketOnlyMaterializesRemovedUserAndKeepsPeerReference() public {
        (uint64 generation, uint64 unlockAt) = gauge.expectedTimes();
        gauge.addPending(ALICE, 100, generation, unlockAt);
        gauge.addPending(BOB, 200, generation, unlockAt);
        vm.warp(unlockAt);

        gauge.removeAllocation(ALICE, 100);

        ActivationSnapshot memory snapshot = gauge.snapshot(generation);
        assertTrue(snapshot.processed);
        assertEq(snapshot.refs, 1);
        assertEq(gauge.storedActive(), 200);
        assertEq(gauge.effectiveUserActive(BOB), 200);
        (uint256 bobActive, uint256 bobPending, uint64 bobGeneration,) = gauge.position(BOB);
        assertEq(bobActive, 0);
        assertEq(bobPending, 200);
        assertEq(bobGeneration, generation);
    }

    function test_materializationOrRemovalSettlementFailureRollsBackEverything() public {
        (uint64 generation, uint64 unlockAt) = gauge.expectedTimes();
        gauge.addPending(ALICE, 100, generation, unlockAt);
        vm.warp(unlockAt);
        gauge.setFailures(true, false);
        vm.expectRevert(MemeStockGaugeLockedPositionsHarness.InjectedMaterializationFailure.selector);
        gauge.removeAllocation(ALICE, 40);
        assertEq(gauge.pendingTotal(), 100);
        assertEq(gauge.storedActive(), 0);
        assertFalse(gauge.snapshot(generation).processed);

        gauge.setFailures(false, true);
        vm.expectRevert(MemeStockGaugeLockedPositionsHarness.InjectedRemovalFailure.selector);
        gauge.removeAllocation(ALICE, 40);
        assertEq(gauge.pendingTotal(), 100);
        assertEq(gauge.storedActive(), 0);
        assertFalse(gauge.snapshot(generation).processed);
        (, uint256 pending,,) = gauge.position(ALICE);
        assertEq(pending, 100);
    }

    function test_totalActiveUnderflowRollsBackUserAndSettlement() public {
        gauge.seedActive(ALICE, 100, uint64(block.timestamp), 50);
        vm.expectRevert(stdError.arithmeticError);
        gauge.removeAllocation(ALICE, 60);

        (uint256 active,,, uint64 unlockAt) = gauge.position(ALICE);
        assertEq(active, 100);
        assertEq(unlockAt, block.timestamp);
        assertEq(gauge.storedActive(), 50);
        assertEq(gauge.removeSequence(), 0);
    }

    function test_checkpointIsFirstEvenWhenRemovalAmountIsInvalid() public {
        (uint64 generation, uint64 unlockAt) = gauge.expectedTimes();
        gauge.addPending(ALICE, 100, generation, unlockAt);
        gauge.injectSnapshot(generation, 1, 2, 9);
        vm.warp(generation);

        vm.expectRevert(
            abi.encodeWithSelector(
                MemeStockGaugeActivationSnapshots.ActivationSnapshotAlreadyProcessed.selector, generation
            )
        );
        gauge.removeAllocation(ALICE, 0);
        assertEq(gauge.pendingTotal(), 100);
        assertEq(gauge.storedActive(), 0);
    }

    function test_oneYearIdleRemovalStillMaterializesAndRemovesAtOldUnlock() public {
        (uint64 generation, uint64 unlockAt) = gauge.expectedTimes();
        gauge.addPending(ALICE, 100, generation, unlockAt);
        vm.warp(uint256(unlockAt) + 365 days);

        assertEq(gauge.removeAllocation(ALICE, 25), 75);
        (uint256 active, uint256 pending,, uint64 storedUnlock) = gauge.position(ALICE);
        assertEq(active, 75);
        assertEq(pending, 0);
        assertEq(storedUnlock, unlockAt);
        assertEq(gauge.storedActive(), 75);
        assertEq(gauge.pendingTotal(), 0);
    }

    function test_repeatedCloseFailsAndCannotUnderflowGlobalWeight() public {
        gauge.seedActive(ALICE, 10, uint64(block.timestamp), 10);
        gauge.removeAllocation(ALICE, 10);
        vm.expectRevert(abi.encodeWithSelector(MemeStockGaugeLockedPositions.NoActiveAllocation.selector, ALICE));
        gauge.removeAllocation(ALICE, 1);
        assertEq(gauge.storedActive(), 0);
    }

    function test_reallocateAfterFullCloseCreatesFreshLockWithoutErasingRewardDebt() public {
        gauge.seedActive(ALICE, 10, uint64(block.timestamp), 10);
        gauge.seedReward(ALICE, 0, 3, 11, 19);
        gauge.removeAllocation(ALICE, 10);
        vm.warp(block.timestamp + 5);
        (uint64 generation, uint64 unlockAt) = gauge.expectedTimes();

        gauge.addPending(ALICE, 20, generation, unlockAt);

        (uint256 active, uint256 pending, uint64 pendingGeneration, uint64 storedUnlock) = gauge.position(ALICE);
        assertEq(active, 0);
        assertEq(pending, 20);
        assertEq(pendingGeneration, generation);
        assertEq(storedUnlock, unlockAt);
        (, uint256 pendingFee, uint256 remainder) = gauge.reward(ALICE, 0);
        assertEq(pendingFee, 11);
        assertEq(remainder, 19);
        assertEq(gauge.pendingTotal(), 20);
        assertEq(gauge.storedActive(), 0);
    }

    function testFuzz_partialAndFullRemovalConserveUserAndGlobalActive(uint128 activeAmount, uint128 removeAmount)
        public
    {
        activeAmount = uint128(bound(activeAmount, 1, type(uint128).max));
        removeAmount = uint128(bound(removeAmount, 1, activeAmount));
        uint64 unlockAt = uint64(block.timestamp);
        gauge.seedActive(ALICE, activeAmount, unlockAt, activeAmount);

        uint256 remaining = gauge.removeAllocation(ALICE, removeAmount);

        (uint256 storedUserActive,,, uint64 storedUnlock) = gauge.position(ALICE);
        assertEq(remaining, uint256(activeAmount) - removeAmount);
        assertEq(storedUserActive, remaining);
        assertEq(gauge.storedActive(), remaining);
        assertEq(storedUnlock, remaining == 0 ? 0 : unlockAt);
        assertEq(gauge.lastRemovalSettlementWeight(), activeAmount);
    }
}
