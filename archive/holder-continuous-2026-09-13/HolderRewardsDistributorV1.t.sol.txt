// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;
import {
    HolderRewardsDistributorV1 as CurrentHolderRewards
} from "../../../../src/v1/modules/HolderRewardsDistributorV1.sol";

import {Test} from "forge-std/Test.sol";
import {HolderAccountingHarness as HolderRewardsDistributorV1} from "../../mocks/HolderAccountingHarness.sol";
import {TickerMemeTokenV1} from "../../../../src/v1/modules/TickerMemeTokenV1.sol";
import {MarketView} from "../../../../src/v1/interfaces/IV1Protocol.sol";
import {MockExactQuoteToken, MockFeeOnTransferQuoteToken} from "../../mocks/MockV1QuoteAssets.sol";

contract ContinuousRegistryMock {
    address public factory;
    address public officialStockRegistry;
    MarketView private value;

    constructor() {
        factory = msg.sender;
    }

    function set(MarketView memory v) external {
        value = v;
    }

    function setStockRegistry(address v) external {
        officialStockRegistry = v;
    }

    function market(bytes32) external view returns (MarketView memory) {
        return value;
    }
}

contract ContinuousVaultMock {
    receive() external payable {}

    function fund(HolderRewardsDistributorV1 d, bytes32 id) external payable {
        d.fundQuoteRewards{value: msg.value}(id, 1, msg.value);
    }

    function fundToken(HolderRewardsDistributorV1 d, bytes32 id, MockExactQuoteToken quote, uint256 amount) external {
        quote.approve(address(d), amount);
        d.fundQuoteRewards(id, 1, amount);
    }
}

contract ContinuousHookMock {
    address public poolManager = address(0xB001);
    address public protocolFeeVault;

    constructor(address v) {
        protocolFeeVault = v;
    }
}

contract ContinuousRejector {
    function claim(HolderRewardsDistributorV1 d, bytes32 id) external {
        d.claim(id);
    }

    receive() external payable {
        revert();
    }
}

contract ContinuousReentrantReceiver {
    HolderRewardsDistributorV1 d;
    bytes32 id;
    bool public nestedSucceeded;

    function claim(HolderRewardsDistributorV1 d_, bytes32 id_) external {
        d = d_;
        id = id_;
        d.claim(id);
    }

    receive() external payable {
        (nestedSucceeded,) = address(d).call(abi.encodeCall(d.claim, (id)));
    }
}

contract HolderRewardsDistributorV1Test is Test {
    bytes32 constant ID = keccak256("continuous-holder-test");
    address constant CURVE = address(0xC001);
    address constant LOCKER = address(0xC002);
    address constant ALICE = address(0xA11CE);
    address constant BOB = address(0xB0B);
    ContinuousRegistryMock registry;
    ContinuousVaultMock vault;
    ContinuousHookMock hook;
    HolderRewardsDistributorV1 d;
    TickerMemeTokenV1 token;
    MarketView value;

    function setUp() public virtual {
        vm.warp(1_800_000_000);
        vm.deal(address(this), 1_000_000 ether);
        _deploy(address(0));
    }

    function test_transferReadsEachEligibleBalanceOnceForBothLedgers() public {
        vm.prank(CURVE);
        token.transfer(ALICE, 100);
        _fund(100);
        vm.warp(block.timestamp + 24 hours);
        vm.expectCall(address(token), abi.encodeWithSelector(token.balanceOf.selector, ALICE), uint64(1));
        vm.expectCall(address(token), abi.encodeWithSelector(token.balanceOf.selector, BOB), uint64(1));
        vm.prank(ALICE);
        token.transfer(BOB, 10);
    }

    function test_selfTransferReadsBalanceOnceAndKeepsBothSupplies() public {
        vm.prank(CURVE);
        token.transfer(ALICE, 100);
        uint256 supply = d.marketState(ID).supply;
        _fund(100);
        vm.warp(block.timestamp + 24 hours);
        vm.expectCall(address(token), abi.encodeWithSelector(token.balanceOf.selector, ALICE), uint64(1));
        vm.prank(ALICE);
        token.transfer(ALICE, 10);
        assertEq(d.marketState(ID).supply, supply);
        assertEq(d.memeMarketState(ID).supply, supply);
    }

    function test_emptyRewardIndicesSkipExternalBalanceReads() public {
        _send(CURVE, ALICE, 100);
        vm.mockCallRevert(
            address(token), abi.encodeWithSelector(token.balanceOf.selector), bytes("UNEXPECTED_BALANCE_READ")
        );
        _send(ALICE, BOB, 20);
        _send(BOB, BOB, 1);
        vm.clearMockedCalls();
        assertEq(token.balanceOf(BOB), 20);
        assertEq(d.marketState(ID).supply, 100);
        assertEq(d.memeMarketState(ID).supply, 100);
    }

    function _deploy(address quote) internal {
        registry = new ContinuousRegistryMock();
        vault = new ContinuousVaultMock();
        hook = new ContinuousHookMock(address(vault));
        d = new HolderRewardsDistributorV1(address(registry));
        token =
            new TickerMemeTokenV1(ID, address(this), CURVE, address(d), "Garden", "GRDN", "ipfs://garden", 1000 ether);
        value.config.memeToken = address(token);
        value.config.curve = CURVE;
        value.config.quoteAsset = quote;
        value.config.creatorFeesToHolders = true;
        value.config.graduatedHook = address(hook);
        registry.set(value);
        d.registerFeeSharingMarket(ID, address(vault), LOCKER);
    }

    function _send(address from, address to, uint256 amount) internal {
        vm.prank(from);
        token.transfer(to, amount);
    }

    function _fund(uint256 amount) internal {
        vault.fund{value: amount}(d, ID);
    }

    function _claim(address who) internal returns (uint256 amount) {
        vm.prank(who);
        amount = d.claim(ID);
    }

    function test_releaseViewReportsMarketTotalsWithoutAssigningFutureRewards() public {
        uint64 start = uint64(block.timestamp);
        _send(CURVE, ALICE, 100 ether);
        _fund(24 ether);
        assertEq(d.lastFundingAt(ID), start);
        vm.warp(start + 12 hours);
        (uint256 remaining, uint256 idle, uint64 end, uint256 active) = d.releaseState(ID);
        assertApproxEqAbs(remaining, 12 ether, 1);
        assertEq(idle, 0);
        assertEq(end, start + 24 hours);
        assertEq(active, 1);
        assertApproxEqAbs(d.claimable(ID, ALICE), 12 ether, 1);
        vm.warp(start + 24 hours);
        (remaining, idle, end, active) = d.releaseState(ID);
        assertEq(remaining, 0);
        assertEq(idle, 0);
        assertEq(end, 0);
        assertEq(active, 0);
    }

    function test_exact24HoursAndAnytimeClaim() public {
        _send(CURVE, ALICE, 100 ether);
        _fund(24 ether);
        assertEq(d.claimable(ID, ALICE), 0);
        vm.warp(block.timestamp + 1 hours);
        assertApproxEqAbs(_claim(ALICE), 1 ether, 1);
        vm.warp(block.timestamp + 23 hours);
        assertApproxEqAbs(_claim(ALICE), 23 ether, 1);
        assertEq(d.totalLiability(address(0)), 0);
    }

    function test_newHolderDoesNotInheritAccruedAndSellerRetainsEarned() public {
        _send(CURVE, ALICE, 100 ether);
        _fund(24 ether);
        vm.warp(block.timestamp + 12 hours);
        _send(ALICE, BOB, 100 ether);
        assertApproxEqAbs(d.claimable(ID, ALICE), 12 ether, 1);
        assertEq(d.claimable(ID, BOB), 0);
        vm.warp(block.timestamp + 12 hours);
        assertApproxEqAbs(_claim(ALICE), 12 ether, 1);
        assertApproxEqAbs(_claim(BOB), 12 ether, 1);
    }

    function test_sameTransactionBorrowReturnEarnsNothing() public {
        _send(CURVE, ALICE, 100 ether);
        _fund(24 ether);
        vm.warp(block.timestamp + 1 hours);
        _send(ALICE, BOB, 100 ether);
        _claim(BOB);
        _send(BOB, ALICE, 100 ether);
        assertEq(_claim(BOB), 0);
        assertApproxEqAbs(_claim(ALICE), 1 ether, 1);
    }

    function test_topUpDoesNotDelayOldStream() public {
        _send(CURVE, ALICE, 100 ether);
        _fund(24 ether);
        vm.warp(block.timestamp + 12 hours);
        _fund(24 ether);
        vm.warp(block.timestamp + 12 hours);
        assertApproxEqAbs(_claim(ALICE), 36 ether, 1);
        vm.warp(block.timestamp + 12 hours);
        assertApproxEqAbs(_claim(ALICE), 12 ether, 1);
    }

    function test_zeroSupplyDoesNotGiveFirstBuyerHistoricalLump() public {
        _fund(24 ether);
        vm.warp(block.timestamp + 24 hours);
        _send(CURVE, ALICE, 100 ether);
        assertEq(d.claimable(ID, ALICE), 0);
        vm.warp(block.timestamp + 12 hours);
        assertApproxEqAbs(_claim(ALICE), 12 ether, 1);
        vm.warp(block.timestamp + 12 hours);
        assertApproxEqAbs(_claim(ALICE), 12 ether, 1);
    }

    function test_allSellThenReturnPreservesPastAndRestreamsIdle() public {
        _send(CURVE, ALICE, 100 ether);
        _fund(24 ether);
        vm.warp(block.timestamp + 6 hours);
        _send(ALICE, CURVE, 100 ether);
        vm.warp(block.timestamp + 18 hours);
        assertApproxEqAbs(_claim(ALICE), 6 ether, 1);
        _send(CURVE, BOB, 100 ether);
        assertEq(d.claimable(ID, BOB), 0);
        vm.warp(block.timestamp + 24 hours);
        assertApproxEqAbs(_claim(BOB), 18 ether, 1);
    }

    function test_frequentCheckpointsAndSelfTransfersPreserveTinyRewards() public {
        _send(CURVE, ALICE, 1 ether);
        _fund(1);
        uint256 start = block.timestamp;
        for (uint256 i = 1; i <= 100; ++i) {
            vm.warp(start + i);
            d.checkpoint(ID);
            _send(ALICE, ALICE, 0);
            _claim(ALICE);
        }
        vm.warp(start + 24 hours);
        assertEq(_claim(ALICE), 1);
    }

    function test_fragmentedFundingQueuesWithoutMovingAdmissionClock() public {
        _send(CURVE, ALICE, 100 ether);
        uint256 start = block.timestamp;
        for (uint256 i; i < 100; ++i) {
            _fund(1 ether);
            vm.warp(block.timestamp + 1);
        }
        assertEq(d.marketState(ID).count, 1);
        assertEq(d.nextStreamStartAt(ID), start + 4 hours);
        assertEq(d.marketState(ID).idle, 99 ether * 1e27);
        vm.warp(start + 4 hours - 1);
        d.checkpoint(ID);
        assertEq(d.marketState(ID).count, 1);
        vm.warp(start + 4 hours);
        d.checkpoint(ID);
        assertEq(d.marketState(ID).count, 2);
        assertEq(d.marketState(ID).idle, 0);
        vm.warp(start + 24 hours);
        assertApproxEqAbs(_claim(ALICE), 1 ether + 99 ether * 20 / 24, 1);
        vm.warp(start + 28 hours);
        _claim(ALICE);
        assertEq(d.marketState(ID).paid, 100 ether);
    }

    function test_sameSecondFundingCoalescesWithoutChangingEnd() public {
        _send(CURVE, ALICE, 100 ether);
        for (uint256 i; i < 70; ++i) {
            _fund(1);
        }
        assertEq(d.marketState(ID).count, 1);
        vm.warp(block.timestamp + 24 hours);
        assertEq(_claim(ALICE), 70);
    }

    function test_failedNativeClaimRollsBackAccountAndLiability() public {
        ContinuousRejector r = new ContinuousRejector();
        _send(CURVE, address(r), 100 ether);
        _fund(24 ether);
        vm.warp(block.timestamp + 24 hours);
        vm.expectRevert(CurrentHolderRewards.TransferFailed.selector);
        r.claim(d, ID);
        assertEq(d.claimable(ID, address(r)), 24 ether);
        assertEq(d.totalLiability(address(0)), 24 ether);
    }

    function test_erc20FundingAndClaim() public {
        MockExactQuoteToken q = new MockExactQuoteToken(6);
        _deploy(address(q));
        _send(CURVE, ALICE, 100 ether);
        q.mint(address(vault), 24e6);
        vault.fundToken(d, ID, q, 24e6);
        vm.warp(block.timestamp + 24 hours);
        assertEq(_claim(ALICE), 24e6);
        assertEq(q.balanceOf(ALICE), 24e6);
    }

    function test_unauthorizedAndInvalidBucketRejected() public {
        vm.expectRevert(CurrentHolderRewards.Unauthorized.selector);
        d.fundQuoteRewards{value: 1}(ID, 1, 1);
        vm.expectRevert(CurrentHolderRewards.Unauthorized.selector);
        d.checkpointTransfer(ID, ALICE, BOB, 1);
        vm.prank(address(vault));
        vm.expectRevert(CurrentHolderRewards.InvalidFunding.selector);
        d.fundQuoteRewards(ID, 2, 1);
        vm.expectRevert(CurrentHolderRewards.InvalidMarket.selector);
        d.registerFeeSharingMarket(ID, address(vault), LOCKER);
    }

    function test_invalidTransferRevertsRewardChanges() public {
        _send(CURVE, ALICE, 100 ether);
        _fund(24 ether);
        vm.warp(block.timestamp + 12 hours);
        vm.prank(ALICE);
        vm.expectRevert();
        token.transfer(BOB, 101 ether);
        assertApproxEqAbs(d.claimable(ID, ALICE), 12 ether, 1);
        assertEq(d.marketState(ID).supply, 100 ether);
    }

    function test_sharedAssetMarketsKeepIndependentLiabilitiesAndClaimRights() public {
        _send(CURVE, ALICE, 100 ether);
        _fund(24 ether);
        bytes32 otherId = keccak256("other-continuous-market");
        TickerMemeTokenV1 other =
            new TickerMemeTokenV1(otherId, address(this), CURVE, address(d), "Other", "O", "", 100 ether);
        value.config.memeToken = address(other);
        registry.set(value);
        d.registerFeeSharingMarket(otherId, address(vault), LOCKER);
        vm.prank(CURVE);
        other.transfer(BOB, 100 ether);
        vault.fund{value: 48 ether}(d, otherId);
        vm.warp(block.timestamp + 24 hours);
        assertEq(d.claimable(ID, BOB), 0);
        assertEq(d.claimable(otherId, ALICE), 0);
        assertEq(_claim(ALICE), 24 ether);
        assertEq(d.totalLiability(address(0)), 48 ether);
        vm.prank(BOB);
        assertEq(d.claim(otherId), 48 ether);
        assertEq(d.totalLiability(address(0)), 0);
    }

    function test_inexactQuoteFundingRollsBackEveryStreamAndBalance() public {
        MockFeeOnTransferQuoteToken q = new MockFeeOnTransferQuoteToken(6, 100);
        _deploy(address(q));
        _send(CURVE, ALICE, 100 ether);
        q.mint(address(vault), 1e6);
        vm.expectRevert(CurrentHolderRewards.InexactTransfer.selector);
        vault.fundToken(d, ID, q, 1e6);
        assertEq(q.balanceOf(address(vault)), 1e6);
        assertEq(q.balanceOf(address(d)), 0);
        assertEq(d.marketState(ID).count, 0);
        assertEq(d.totalLiability(address(q)), 0);
    }

    function test_nativeRecipientCannotReenterAndClaimTwice() public {
        ContinuousReentrantReceiver r = new ContinuousReentrantReceiver();
        _send(CURVE, address(r), 100 ether);
        _fund(24 ether);
        vm.warp(block.timestamp + 24 hours);
        r.claim(d, ID);
        assertFalse(r.nestedSucceeded());
        assertEq(address(r).balance, 24 ether);
        assertEq(d.totalLiability(address(0)), 0);
    }

    function test_sixExpiredBatchesHaveBoundedTransferGas() public {
        _send(CURVE, ALICE, 100 ether);
        for (uint256 i; i < 6; ++i) {
            _fund(1 ether);
            vm.warp(block.timestamp + 4 hours);
        }
        vm.warp(block.timestamp + 24 hours);
        uint256 beforeGas = gasleft();
        _send(ALICE, BOB, 1 ether);
        uint256 used = beforeGas - gasleft();
        emit log_named_uint("transfer gas with six expired batches", used);
        assertLt(used, 400_000);
        assertEq(d.marketState(ID).count, 0);
        assertEq(d.claimable(ID, BOB), 0);
        assertEq(_claim(ALICE), 6 ether);
    }

    function testFuzz_manyTransfersMatchIndependentPiecewiseIntegral(uint256 seed) public {
        _send(CURVE, ALICE, 100 ether);
        _fund(86400 ether);
        uint256 expectedA;
        uint256 expectedB;
        uint256 balanceA = 100;
        uint256 paidA;
        uint256 paidB;
        // 48 half-hour intervals with independent integer shares; both remain eligible at every interval.
        for (uint256 i; i < 48; ++i) {
            vm.warp(block.timestamp + 1800);
            expectedA += 1800 ether * balanceA / 100;
            expectedB += 1800 ether * (100 - balanceA) / 100;
            seed = uint256(keccak256(abi.encode(seed, i)));
            uint256 next = seed % 101;
            if (next < balanceA) _send(ALICE, BOB, (balanceA - next) * 1 ether);
            else if (next > balanceA) _send(BOB, ALICE, (next - balanceA) * 1 ether);
            balanceA = next;
            if (seed % 3 == 0) {
                paidA += _claim(ALICE);
                paidB += _claim(BOB);
            }
            assertEq(d.marketState(ID).supply, 100 ether);
        }
        paidA += _claim(ALICE);
        paidB += _claim(BOB);
        assertEq(paidA, expectedA);
        assertEq(paidB, expectedB);
        assertEq(paidA + paidB, 86400 ether);
        assertEq(d.totalLiability(address(0)), 0);
    }

    function testFuzz_twoHolderTimeIntegral(uint96 amountRaw, uint32 elapsedRaw, uint16 shareRaw) public {
        uint256 amount = bound(uint256(amountRaw), 1 ether, 1000 ether);
        uint256 elapsed = bound(uint256(elapsedRaw), 0, 86400);
        uint256 share = bound(uint256(shareRaw), 1, 99);
        _send(CURVE, ALICE, 100 ether);
        _fund(amount);
        vm.warp(block.timestamp + elapsed);
        _send(ALICE, BOB, share * 1 ether);
        vm.warp(block.timestamp + 86400 - elapsed);
        uint256 paidA = _claim(ALICE);
        uint256 paidB = _claim(BOB);
        uint256 expectedB = amount * (86400 - elapsed) * share / 86400 / 100;
        assertApproxEqAbs(paidB, expectedB, 2);
        assertApproxEqAbs(paidA, amount - expectedB, 2);
        assertLe(paidA + paidB, amount);
        assertLe(amount - paidA - paidB, 2);
    }
}

contract DualHolderRewardsTest is HolderRewardsDistributorV1Test {
    function _fundMeme(uint256 amount) private {
        _send(CURVE, address(vault), amount);
        vm.prank(address(vault));
        token.approve(address(d), amount);
        vm.prank(address(vault));
        d.fundMemeFees(ID, amount);
    }

    function test_dualAssetsFollowSameWeightsWithoutRestoration() public {
        _send(CURVE, ALICE, 100 ether);
        _send(CURVE, BOB, 100 ether);
        _fund(24 ether);
        _fundMeme(240 ether);
        vm.warp(block.timestamp + 24 hours);
        (uint256 aq, uint256 am) = d.claimableAssets(ID, ALICE);
        assertEq(aq, 12 ether);
        assertEq(am, 120 ether);
        vm.prank(address(vault));
        (uint256 q, uint256 m) = d.consumeUserRewards(ID, ALICE);
        assertEq(q, 12 ether);
        assertEq(m, 120 ether);
        vm.prank(address(vault));
        token.approve(address(d), 60 ether);
        vm.prank(address(vault));
        (bool ok,) =
            address(d).call(abi.encodeWithSignature("restoreUserMeme(bytes32,address,uint256)", ID, ALICE, 60 ether));
        assertFalse(ok);
        (aq, am) = d.claimableAssets(ID, ALICE);
        assertEq(aq, 0);
        assertEq(am, 0);
        (uint256 bq, uint256 bm) = d.claimableAssets(ID, BOB);
        assertEq(bq, 12 ether);
        assertEq(bm, 120 ether);
        assertEq(d.totalLiability(address(token)), 120 ether);
    }

    function test_memeReleaseNotAssignedToBuyerOfOldBalance() public {
        _send(CURVE, ALICE, 100 ether);
        _fundMeme(240 ether);
        vm.warp(block.timestamp + 12 hours);
        _send(ALICE, BOB, 100 ether);
        (, uint256 alice) = d.claimableAssets(ID, ALICE);
        (, uint256 bob) = d.claimableAssets(ID, BOB);
        assertApproxEqAbs(alice, 120 ether, 1);
        assertEq(bob, 0);
        vm.warp(block.timestamp + 12 hours);
        (, bob) = d.claimableAssets(ID, BOB);
        assertApproxEqAbs(bob, 120 ether, 1);
    }

    function test_memeFundingAndConsumptionAreVaultOnly() public {
        vm.expectRevert();
        d.fundMemeFees(ID, 1);
        vm.expectRevert();
        d.consumeUserRewards(ID, ALICE);
        (bool ok,) = address(d).call(abi.encodeWithSignature("restoreUserMeme(bytes32,address,uint256)", ID, ALICE, 1));
        assertFalse(ok);
    }
}
