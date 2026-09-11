// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {stdError} from "forge-std/StdError.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

import {ActivationSlot, ActivationSnapshot} from "../../../src/v1/interfaces/IV1Protocol.sol";
import {MemeStockGaugeAccumulators} from "../../../src/v1/shared/MemeStockGaugeAccumulators.sol";

contract MemeStockGaugeAccumulatorsHarness is MemeStockGaugeAccumulators {
    bytes32 public constant MARKET_ID = keccak256("accumulator-market");

    function credit(uint8 rewardIndex, address feeAsset, uint256 amount, bytes32 feeId)
        external
        returns (uint256 accumulatorDelta, uint256 indexRemainder)
    {
        return _creditStakerFee(rewardIndex, feeAsset, amount, feeId, MARKET_ID);
    }

    function addPending(address user, uint256 amount, uint64 generation, uint64 unlockAt) external {
        _addPending(
            user,
            amount,
            generation,
            unlockAt,
            MARKET_ID,
            _rewardStates[QUOTE_REWARD_INDEX].accFeePerShare,
            _rewardStates[MEME_REWARD_INDEX].accFeePerShare
        );
    }

    function expectedTimes() external view returns (uint64 generation, uint64 unlockAt) {
        return (_nextActivationGeneration(), _nextPositionUnlockAt());
    }

    function rewardState(uint8 rewardIndex) external view returns (uint256 accumulator, uint256 remainder) {
        if (rewardIndex >= REWARD_ASSET_COUNT) revert InvalidRewardIndex(rewardIndex);
        GaugeRewardState memory state = _rewardStates[rewardIndex];
        return (state.accFeePerShare, state.indexRemainder);
    }

    function userReward(address user, uint8 rewardIndex)
        external
        view
        returns (uint256 paid, uint256 pendingFee, uint256 remainder)
    {
        GaugeUserReward storage reward = _gaugePositions[user].rewards[rewardIndex];
        return (reward.accumulatorPaid, reward.pendingFee, reward.userRemainder);
    }

    function claimable(address user, uint8 rewardIndex) external view returns (uint256) {
        if (rewardIndex >= REWARD_ASSET_COUNT) revert InvalidRewardIndex(rewardIndex);
        return _gaugePositions[user].rewards[rewardIndex].pendingFee;
    }

    function consumeClaimable(address user, uint8 rewardIndex) external returns (uint256) {
        return _consumeClaimable(user, rewardIndex);
    }

    function accrueTerm(
        address user,
        uint8 rewardIndex,
        uint256 amount,
        uint256 startingAccumulator,
        uint256 currentAccumulator
    ) external returns (uint256) {
        return _accrueRewardTerm(
            _gaugePositions[user].rewards[rewardIndex], amount, startingAccumulator, currentAccumulator
        );
    }

    function settleToCurrent(address user, uint8 rewardIndex, uint256 amount, uint256 currentAccumulator)
        external
        returns (uint256)
    {
        return _settleRewardToCurrent(_gaugePositions[user].rewards[rewardIndex], amount, currentAccumulator);
    }

    function seedActive(uint256 amount) external {
        _storedTotalActiveStock = amount;
    }

    function seedRewardState(uint8 rewardIndex, uint256 accumulator, uint256 remainder) external {
        _rewardStates[rewardIndex] = GaugeRewardState(accumulator, remainder);
    }

    function seedUserReward(address user, uint8 rewardIndex, uint256 paid, uint256 pendingFee, uint256 remainder)
        external
    {
        _gaugePositions[user].rewards[rewardIndex] = GaugeUserReward(paid, pendingFee, remainder);
    }

    function storedActive() external view returns (uint256) {
        return _storedTotalActiveStock;
    }

    function slot(uint8 slotIndex) external view returns (ActivationSlot memory) {
        return _activationSlot(slotIndex);
    }

    function snapshot(uint64 generation) external view returns (ActivationSnapshot memory) {
        return _activationSnapshot(generation);
    }

    function precision() external pure returns (uint256) {
        return INDEX_PRECISION;
    }

    function _settleMaterializingPosition(
        address,
        GaugePosition storage position,
        ActivationSnapshot memory,
        uint256 currentQuoteAccumulator,
        uint256 currentMemeAccumulator
    ) internal override {
        position.rewards[QUOTE_REWARD_INDEX].accumulatorPaid = currentQuoteAccumulator;
        position.rewards[MEME_REWARD_INDEX].accumulatorPaid = currentMemeAccumulator;
    }

    function _settleRemovingPosition(address, GaugePosition storage, uint256, uint256) internal pure override {}
}

contract MemeStockGaugeAccumulatorsTest is Test {
    uint256 internal constant P = 1e27;
    address internal constant ALICE = address(0xA11CE);
    address internal constant BOB = address(0xB0B);
    address internal constant CAROL = address(0xCA201);
    address internal constant DAVE = address(0xDA7E);
    address internal constant QUOTE = address(0xA0);
    address internal constant MEME = address(0xB0);
    bytes32 internal constant FEE_ID = keccak256("fee-id");

    MemeStockGaugeAccumulatorsHarness internal gauge;

    event StakerFeeCredited(
        bytes32 indexed marketId,
        address indexed feeAsset,
        bytes32 indexed feeId,
        uint256 amount,
        uint256 accumulatorDelta,
        uint256 indexRemainder
    );

    function setUp() public {
        gauge = new MemeStockGaugeAccumulatorsHarness();
        gauge.seedActive(3);
        vm.warp(1_000_000);
    }

    function test_quoteCreditUsesFullPrecisionAndLeavesMemeStateUntouched() public {
        uint256 expectedDelta = (2 * P) / 3;
        uint256 expectedRemainder = mulmod(2, P, 3);
        vm.expectEmit(true, true, true, true);
        emit StakerFeeCredited(gauge.MARKET_ID(), QUOTE, FEE_ID, 2, expectedDelta, expectedRemainder);

        (uint256 delta, uint256 remainder) = gauge.credit(0, QUOTE, 2, FEE_ID);

        assertEq(delta, expectedDelta);
        assertEq(remainder, expectedRemainder);
        _assertRewardState(0, expectedDelta, expectedRemainder);
        _assertRewardState(1, 0, 0);
    }

    function test_memeCreditIsFullyIsolatedFromQuoteIndexAndRemainder() public {
        gauge.seedRewardState(0, 77, 2);
        gauge.credit(1, MEME, 5, FEE_ID);

        _assertRewardState(0, 77, 2);
        (uint256 memeAccumulator, uint256 memeRemainder) = gauge.rewardState(1);
        assertEq(memeAccumulator, (5 * P) / 3);
        assertEq(memeRemainder, mulmod(5, P, 3));
    }

    function test_zeroCreditIsNoOpAndDoesNotRequireActiveStock() public {
        gauge.seedActive(0);
        gauge.seedRewardState(0, 11, 9);
        (uint256 delta, uint256 remainder) = gauge.credit(0, QUOTE, 0, FEE_ID);
        assertEq(delta, 0);
        assertEq(remainder, 9);
        _assertRewardState(0, 11, 9);
    }

    function test_nonzeroCreditWithNoActiveStockFailsClosed() public {
        gauge.seedActive(0);
        vm.expectRevert(abi.encodeWithSelector(MemeStockGaugeAccumulators.StakerCreditWithoutActiveStock.selector, 1));
        gauge.credit(0, QUOTE, 1, FEE_ID);
        _assertRewardState(0, 0, 0);
    }

    function test_unmaturedPendingDoesNotCountAsActiveStockForCredit() public {
        gauge.seedActive(0);
        (uint64 generation, uint64 unlockAt) = gauge.expectedTimes();
        gauge.addPending(ALICE, 4, generation, unlockAt);

        vm.expectRevert(abi.encodeWithSelector(MemeStockGaugeAccumulators.StakerCreditWithoutActiveStock.selector, 1));
        gauge.credit(0, QUOTE, 1, FEE_ID);

        assertEq(gauge.storedActive(), 0);
        assertEq(gauge.slot(uint8(generation % 32)).amount, 4);
        _assertRewardState(0, 0, 0);
    }

    function test_exactMaturityCheckpointsBeforeCreditAndSnapshotsOldIndices() public {
        gauge.seedActive(0);
        (uint64 generation, uint64 unlockAt) = gauge.expectedTimes();
        gauge.addPending(ALICE, 4, generation, unlockAt);
        gauge.seedRewardState(0, 7, 0);
        gauge.seedRewardState(1, 13, 0);
        vm.warp(generation);

        gauge.credit(0, QUOTE, 8, FEE_ID);

        assertEq(gauge.storedActive(), 4);
        ActivationSnapshot memory snapshot = gauge.snapshot(generation);
        assertTrue(snapshot.processed);
        assertEq(snapshot.quoteAccumulator, 7);
        assertEq(snapshot.memeAccumulator, 13);
        _assertRewardState(0, 7 + 2 * P, 0);
        _assertRewardState(1, 13, 0);
    }

    function test_invalidIndexRevertsAfterCheckpointAndRollsBackProcessedBucket() public {
        gauge.seedActive(0);
        (uint64 generation, uint64 unlockAt) = gauge.expectedTimes();
        gauge.addPending(ALICE, 4, generation, unlockAt);
        vm.warp(generation);

        vm.expectRevert(abi.encodeWithSelector(MemeStockGaugeAccumulators.InvalidRewardIndex.selector, 2));
        gauge.credit(2, QUOTE, 1, FEE_ID);

        assertEq(gauge.storedActive(), 0);
        assertEq(gauge.slot(uint8(generation % 32)).generation, generation);
        assertFalse(gauge.snapshot(generation).processed);
    }

    function test_oldPoolRemainderNormalizesAgainstNewDenominator() public {
        gauge.seedActive(1);
        gauge.seedRewardState(0, 17, 9);

        (uint256 delta, uint256 remainder) = gauge.credit(0, QUOTE, 1, FEE_ID);

        assertEq(delta, P + 9);
        assertEq(remainder, 0);
        _assertRewardState(0, 17 + P + 9, 0);
    }

    function test_maximumActiveStockMergesFractionalCarryWithoutOverflow() public {
        uint256 activeStock = type(uint256).max;
        uint256 previousRemainder = activeStock - 1;
        gauge.seedActive(activeStock);
        gauge.seedRewardState(0, 0, previousRemainder);

        (uint256 delta, uint256 newRemainder) = gauge.credit(0, QUOTE, 1, FEE_ID);

        assertEq(delta, 1);
        assertEq(newRemainder, P - 1);
        assertEq(activeStock - previousRemainder + newRemainder, P);
        _assertRewardState(0, delta, newRemainder);
    }

    function test_maximumAdmittedRewardUsesMulDivWithoutIntermediateOverflow() public {
        uint256 reward = uint256(uint128(type(int128).max));
        gauge.seedActive(414);

        (uint256 delta, uint256 remainder) = gauge.credit(0, QUOTE, reward, FEE_ID);

        assertEq(delta, (reward * P) / 414);
        assertEq(remainder, (reward * P) % 414);
    }

    function test_maximumAdmittedActiveStockAndRewardRemainExact() public {
        uint256 maximum = uint256(uint128(type(int128).max));
        gauge.seedActive(maximum);

        (uint256 delta, uint256 remainder) = gauge.credit(1, MEME, maximum, FEE_ID);

        assertEq(delta, P);
        assertEq(remainder, 0);
        _assertRewardState(0, 0, 0);
        _assertRewardState(1, P, 0);
    }

    function test_dynamicMinimumExamplesAndMaximumSupplyStayInsideAccumulatorDomain() public {
        uint256 maximum = uint256(uint128(type(int128).max));
        uint256 previousAccumulator;
        uint256 previousRemainder;
        uint256[3] memory configuredMinimums = [uint256(414), uint256(500_000), uint256(10 ether)];

        for (uint256 i; i < configuredMinimums.length; ++i) {
            uint256 minimumPosition = configuredMinimums[i];
            gauge.seedActive(minimumPosition);
            (uint256 delta, uint256 newRemainder) = gauge.credit(0, QUOTE, maximum, FEE_ID);
            (uint256 accumulator,) = gauge.rewardState(0);

            assertEq(maximum * P + previousRemainder, delta * minimumPosition + newRemainder);
            assertEq(accumulator, previousAccumulator + delta);
            assertLt(newRemainder, minimumPosition);
            previousAccumulator = accumulator;
            previousRemainder = newRemainder;
        }

        MemeStockGaugeAccumulatorsHarness maximumSupplyGauge = new MemeStockGaugeAccumulatorsHarness();
        maximumSupplyGauge.seedActive(maximum);
        (uint256 maximumDelta, uint256 maximumRemainder) = maximumSupplyGauge.credit(0, QUOTE, maximum, FEE_ID);
        assertEq(maximumDelta, P);
        assertEq(maximumRemainder, 0);
    }

    function test_maximumLifetimeAccumulatorProofRetainsRecordedUint256Headroom() public pure {
        uint256 maximum = uint256(uint128(type(int128).max));
        uint256 minimumActive = 414;
        uint256 maximumCredits = type(uint48).max;
        uint256 maximumDelta = Math.mulDiv(maximum, P, minimumActive) + ((maximum - 1) / minimumActive) + 1;
        uint256 maximumAccumulator = maximumDelta * maximumCredits;

        assertEq(maximumDelta, 410969042175046453458181893444505529438331477612771265014212816);
        assertEq(maximumAccumulator, 115677501575021392952934502843251004716326723164096785336269155381167824754480);
        assertEq(type(uint256).max / maximumAccumulator, 1);
        assertLt(maximumAccumulator, type(uint256).max);
    }

    function test_accumulatorOverflowRevertsWithoutChangingState() public {
        gauge.seedActive(1);
        gauge.seedRewardState(0, type(uint256).max, 0);
        vm.expectRevert(stdError.arithmeticError);
        gauge.credit(0, QUOTE, 1, FEE_ID);
        _assertRewardState(0, type(uint256).max, 0);
    }

    function test_userTermCarriesFractionIntoClaimableWithoutAdvancingPaidIndex() public {
        gauge.seedUserReward(ALICE, 0, 31, 7, P - 1);

        assertEq(gauge.accrueTerm(ALICE, 0, 2, 10, 10 + P / 2 + 1), 2);

        (uint256 paid, uint256 pendingFee, uint256 remainder) = gauge.userReward(ALICE, 0);
        assertEq(paid, 31);
        assertEq(pendingFee, 9);
        assertEq(remainder, 1);
    }

    function test_settleToCurrentAdvancesOnlySelectedAssetPaidIndex() public {
        gauge.seedUserReward(ALICE, 0, 5, 1, 2);
        gauge.seedUserReward(ALICE, 1, 9, 3, 4);

        gauge.settleToCurrent(ALICE, 0, 6, 5 + P);

        _assertUserReward(0, 5 + P, 7, 2);
        _assertUserReward(1, 9, 3, 4);
    }

    function test_userAccumulatorRegressionAndMalformedRemainderFailClosed() public {
        gauge.seedUserReward(ALICE, 0, 0, 5, 7);
        vm.expectRevert(abi.encodeWithSelector(MemeStockGaugeAccumulators.RewardAccumulatorRegression.selector, 11, 10));
        gauge.accrueTerm(ALICE, 0, 1, 11, 10);
        _assertUserReward(0, 0, 5, 7);

        gauge.seedUserReward(ALICE, 0, 0, 5, P);
        vm.expectRevert(abi.encodeWithSelector(MemeStockGaugeAccumulators.InvalidUserRewardRemainder.selector, P));
        gauge.accrueTerm(ALICE, 0, 1, 0, 1);
        _assertUserReward(0, 0, 5, P);
    }

    function test_consumeClaimablePreservesPaidAndRemainderAndOtherAsset() public {
        gauge.seedUserReward(ALICE, 0, 11, 13, 17);
        gauge.seedUserReward(ALICE, 1, 19, 23, 29);

        assertEq(gauge.claimable(ALICE, 0), 13);
        assertEq(gauge.consumeClaimable(ALICE, 0), 13);
        assertEq(gauge.claimable(ALICE, 0), 0);
        _assertUserReward(0, 11, 0, 17);
        _assertUserReward(1, 19, 23, 29);
    }

    function test_pendingFeeOverflowRevertsWithoutLosingFraction() public {
        gauge.seedUserReward(ALICE, 0, 0, type(uint256).max, 7);
        vm.expectRevert(stdError.arithmeticError);
        gauge.accrueTerm(ALICE, 0, 1, 0, P);
        _assertUserReward(0, 0, type(uint256).max, 7);
    }

    function testFuzz_poolAccumulatorConservesScaledReward(uint128 reward, uint96 activeStock, uint96 previousRemainder)
        public
    {
        reward = uint128(bound(reward, 1, type(uint128).max));
        activeStock = uint96(bound(activeStock, 1, type(uint96).max));
        previousRemainder = uint96(bound(previousRemainder, 0, type(uint96).max));
        gauge.seedActive(activeStock);
        gauge.seedRewardState(0, 0, previousRemainder);

        (uint256 delta, uint256 newRemainder) = gauge.credit(0, QUOTE, reward, FEE_ID);

        assertEq(uint256(reward) * P + previousRemainder, delta * activeStock + newRemainder);
        assertLt(newRemainder, activeStock);
    }

    function testFuzz_userSettlementConservesScaledEntitlement(
        uint96 activeStock,
        uint128 accumulatorDelta,
        uint88 previousRemainder
    ) public {
        previousRemainder = uint88(bound(previousRemainder, 0, P - 1));
        gauge.seedUserReward(ALICE, 0, 0, 0, previousRemainder);

        uint256 accrued = gauge.accrueTerm(ALICE, 0, activeStock, 0, accumulatorDelta);
        (,, uint256 newRemainder) = gauge.userReward(ALICE, 0);

        assertEq(uint256(activeStock) * accumulatorDelta + previousRemainder, accrued * P + newRemainder);
        assertLt(newRemainder, P);
    }

    function testFuzz_fourArbitraryUsersConserveEveryScaledUnitAndCarryAllEconomicDust(
        uint64 aliceShare,
        uint64 bobShare,
        uint64 carolShare,
        uint64 daveShare,
        uint96 reward
    ) public {
        aliceShare = uint64(bound(aliceShare, 1, type(uint64).max));
        bobShare = uint64(bound(bobShare, 1, type(uint64).max));
        carolShare = uint64(bound(carolShare, 1, type(uint64).max));
        daveShare = uint64(bound(daveShare, 1, type(uint64).max));
        reward = uint96(bound(reward, 1, type(uint96).max));
        uint256 totalActive = uint256(aliceShare) + bobShare + carolShare + daveShare;
        gauge.seedActive(totalActive);

        (uint256 delta, uint256 poolRemainder) = gauge.credit(0, QUOTE, reward, FEE_ID);
        uint256 totalClaimable;
        uint256 totalUserRemainder;
        address[4] memory users = [ALICE, BOB, CAROL, DAVE];
        uint256[4] memory shares = [uint256(aliceShare), uint256(bobShare), uint256(carolShare), uint256(daveShare)];
        for (uint256 i; i < users.length; ++i) {
            gauge.accrueTerm(users[i], 0, shares[i], 0, delta);
            (, uint256 claimableAmount, uint256 userRemainder) = gauge.userReward(users[i], 0);
            totalClaimable += claimableAmount;
            totalUserRemainder += userRemainder;
            assertLt(userRemainder, P);
        }

        uint256 carriedScaledDust = totalUserRemainder + poolRemainder;
        assertEq(uint256(reward) * P, totalClaimable * P + carriedScaledDust);
        assertEq((uint256(reward) - totalClaimable) * P, carriedScaledDust);
        assertLt(poolRemainder, totalActive);
        assertLe(uint256(reward) - totalClaimable, 4);
    }

    function _assertRewardState(uint8 rewardIndex, uint256 expectedAccumulator, uint256 expectedRemainder)
        private
        view
    {
        (uint256 accumulator, uint256 remainder) = gauge.rewardState(rewardIndex);
        assertEq(accumulator, expectedAccumulator);
        assertEq(remainder, expectedRemainder);
    }

    function _assertUserReward(uint8 rewardIndex, uint256 expectedPaid, uint256 expectedFee, uint256 expectedRemainder)
        private
        view
    {
        (uint256 paid, uint256 pendingFee, uint256 remainder) = gauge.userReward(ALICE, rewardIndex);
        assertEq(paid, expectedPaid);
        assertEq(pendingFee, expectedFee);
        assertEq(remainder, expectedRemainder);
    }
}
