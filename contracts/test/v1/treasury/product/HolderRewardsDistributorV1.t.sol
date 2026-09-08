// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {HolderRewardsDistributorV1} from "../../../../src/v1/modules/HolderRewardsDistributorV1.sol";
import {TickerMemeTokenV1} from "../../../../src/v1/modules/TickerMemeTokenV1.sol";
import {MarketView} from "../../../../src/v1/interfaces/IV1Protocol.sol";
import {MockExactQuoteToken, MockFeeOnTransferQuoteToken} from "../../mocks/MockV1QuoteAssets.sol";

contract ContinuousRegistryMock {
    address public factory;
    MarketView private value;
    constructor() { factory = msg.sender; }
    function set(MarketView memory v) external { value = v; }
    function market(bytes32) external view returns (MarketView memory) { return value; }
}
contract ContinuousVaultMock {
    function fund(HolderRewardsDistributorV1 d, bytes32 id) external payable {
        d.fundCreatorFees{value: msg.value}(id, 1, msg.value);
    }
    function fundToken(HolderRewardsDistributorV1 d, bytes32 id, MockExactQuoteToken quote, uint256 amount) external {
        quote.approve(address(d), amount); d.fundCreatorFees(id, 1, amount);
    }
}
contract ContinuousHookMock {
    address public poolManager = address(0xB001);
    address public protocolFeeVault;
    constructor(address v) { protocolFeeVault = v; }
}
contract ContinuousRejector {
    function claim(HolderRewardsDistributorV1 d, bytes32 id) external { d.claim(id); }
    receive() external payable { revert(); }
}

contract ContinuousReentrantReceiver {
    HolderRewardsDistributorV1 d;
    bytes32 id;
    bool public nestedSucceeded;
    function claim(HolderRewardsDistributorV1 d_, bytes32 id_) external { d = d_; id = id_; d.claim(id); }
    receive() external payable { (nestedSucceeded,) = address(d).call(abi.encodeCall(d.claim, (id))); }
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

    function setUp() public {
        vm.warp(1_800_000_000); vm.deal(address(this), 1_000_000 ether);
        _deploy(address(0));
    }
    function _deploy(address quote) internal {
        registry = new ContinuousRegistryMock(); vault = new ContinuousVaultMock();
        hook = new ContinuousHookMock(address(vault)); d = new HolderRewardsDistributorV1(address(registry));
        token = new TickerMemeTokenV1(ID, address(this), CURVE, address(d), "Garden", "GRDN", "ipfs://garden", 1000 ether);
        value.config.memeToken = address(token); value.config.curve = CURVE;
        value.config.quoteAsset = quote; value.config.creatorFeesToHolders = true;
        value.config.graduatedHook = address(hook); registry.set(value);
        d.registerFeeSharingMarket(ID, address(vault), LOCKER);
    }
    function _send(address from, address to, uint256 amount) internal { vm.prank(from); token.transfer(to, amount); }
    function _fund(uint256 amount) internal { vault.fund{value: amount}(d, ID); }
    function _claim(address who) internal returns (uint256 amount) { vm.prank(who); amount = d.claim(ID); }

    function test_releaseViewReportsMarketTotalsWithoutAssigningFutureRewards() public {
        uint64 start = uint64(block.timestamp);
        _send(CURVE, ALICE, 100 ether); _fund(24 ether);
        assertEq(d.lastFundingAt(ID), start);
        vm.warp(start + 12 hours);
        (uint256 remaining, uint256 idle, uint64 end, uint256 active) = d.releaseState(ID);
        assertApproxEqAbs(remaining, 12 ether, 1); assertEq(idle, 0);
        assertEq(end, start + 24 hours); assertEq(active, 1);
        assertApproxEqAbs(d.claimable(ID, ALICE), 12 ether, 1);
        vm.warp(start + 24 hours);
        (remaining, idle, end, active) = d.releaseState(ID);
        assertEq(remaining, 0); assertEq(idle, 0); assertEq(end, 0); assertEq(active, 0);
    }
    function test_exact24HoursAndAnytimeClaim() public {
        _send(CURVE, ALICE, 100 ether); _fund(24 ether);
        assertEq(d.claimable(ID, ALICE), 0);
        vm.warp(block.timestamp + 1 hours); assertApproxEqAbs(_claim(ALICE), 1 ether, 1);
        vm.warp(block.timestamp + 23 hours); assertApproxEqAbs(_claim(ALICE), 23 ether, 1);
        assertEq(d.totalLiability(address(0)), 0);
    }
    function test_newHolderDoesNotInheritAccruedAndSellerRetainsEarned() public {
        _send(CURVE, ALICE, 100 ether); _fund(24 ether);
        vm.warp(block.timestamp + 12 hours); _send(ALICE, BOB, 100 ether);
        assertApproxEqAbs(d.claimable(ID, ALICE), 12 ether, 1); assertEq(d.claimable(ID, BOB), 0);
        vm.warp(block.timestamp + 12 hours);
        assertApproxEqAbs(_claim(ALICE), 12 ether, 1); assertApproxEqAbs(_claim(BOB), 12 ether, 1);
    }
    function test_sameTransactionBorrowReturnEarnsNothing() public {
        _send(CURVE, ALICE, 100 ether); _fund(24 ether);
        vm.warp(block.timestamp + 1 hours);
        _send(ALICE, BOB, 100 ether); _claim(BOB); _send(BOB, ALICE, 100 ether);
        assertEq(_claim(BOB), 0); assertApproxEqAbs(_claim(ALICE), 1 ether, 1);
    }
    function test_topUpDoesNotDelayOldStream() public {
        _send(CURVE, ALICE, 100 ether); _fund(24 ether);
        vm.warp(block.timestamp + 12 hours); _fund(24 ether);
        vm.warp(block.timestamp + 12 hours); assertApproxEqAbs(_claim(ALICE), 36 ether, 1);
        vm.warp(block.timestamp + 12 hours); assertApproxEqAbs(_claim(ALICE), 12 ether, 1);
    }
    function test_zeroSupplyDoesNotGiveFirstBuyerHistoricalLump() public {
        _fund(24 ether); vm.warp(block.timestamp + 24 hours);
        _send(CURVE, ALICE, 100 ether); assertEq(d.claimable(ID, ALICE), 0);
        vm.warp(block.timestamp + 12 hours); assertApproxEqAbs(_claim(ALICE), 12 ether, 1);
        vm.warp(block.timestamp + 12 hours); assertApproxEqAbs(_claim(ALICE), 12 ether, 1);
    }
    function test_allSellThenReturnPreservesPastAndRestreamsIdle() public {
        _send(CURVE, ALICE, 100 ether); _fund(24 ether);
        vm.warp(block.timestamp + 6 hours); _send(ALICE, CURVE, 100 ether);
        vm.warp(block.timestamp + 18 hours); assertApproxEqAbs(_claim(ALICE), 6 ether, 1);
        _send(CURVE, BOB, 100 ether); assertEq(d.claimable(ID, BOB), 0);
        vm.warp(block.timestamp + 24 hours); assertApproxEqAbs(_claim(BOB), 18 ether, 1);
    }
    function test_poolLockerAndBurnInventoryExcluded() public {
        _send(CURVE, ALICE, 100 ether); _send(CURVE, hook.poolManager(), 400 ether);
        _send(CURVE, LOCKER, 200 ether); _send(CURVE, address(d), 100 ether);
        vm.prank(address(d)); token.burnTreasury(100 ether);
        assertEq(d.marketState(ID).supply, 100 ether);
        _fund(24 ether); vm.warp(block.timestamp + 24 hours);
        assertApproxEqAbs(_claim(ALICE), 24 ether, 1); assertEq(d.claimable(ID, LOCKER), 0);
    }
    function test_frequentCheckpointsAndSelfTransfersPreserveTinyRewards() public {
        _send(CURVE, ALICE, 1 ether); _fund(1);
        uint256 start = block.timestamp;
        for (uint256 i = 1; i <= 100; ++i) {
            vm.warp(start + i); d.checkpoint(ID); _send(ALICE, ALICE, 0); _claim(ALICE);
        }
        vm.warp(start + 24 hours); assertEq(_claim(ALICE), 1);
    }
    function test_capacityOnlyDefersFundingNotTransfersOrClaims() public {
        _send(CURVE, ALICE, 100 ether);
        for (uint256 i; i < 64; ++i) { _fund(1 ether); vm.warp(block.timestamp + 1); }
        vm.expectRevert(HolderRewardsDistributorV1.StreamCapacity.selector); _fund(1 ether);
        _send(ALICE, BOB, 1 ether); _claim(ALICE);
        vm.warp(block.timestamp + 24 hours); d.checkpoint(ID);
        _fund(1 ether); assertEq(d.marketState(ID).count, 1);
    }
    function test_sameSecondFundingCoalescesWithoutChangingEnd() public {
        _send(CURVE, ALICE, 100 ether);
        for (uint256 i; i < 70; ++i) _fund(1);
        assertEq(d.marketState(ID).count, 1);
        vm.warp(block.timestamp + 24 hours); assertEq(_claim(ALICE), 70);
    }
    function test_failedNativeClaimRollsBackAccountAndLiability() public {
        ContinuousRejector r = new ContinuousRejector(); _send(CURVE, address(r), 100 ether);
        _fund(24 ether); vm.warp(block.timestamp + 24 hours);
        vm.expectRevert(HolderRewardsDistributorV1.TransferFailed.selector); r.claim(d, ID);
        assertEq(d.claimable(ID, address(r)), 24 ether); assertEq(d.totalLiability(address(0)), 24 ether);
    }
    function test_erc20FundingAndClaim() public {
        MockExactQuoteToken q = new MockExactQuoteToken(6); _deploy(address(q));
        _send(CURVE, ALICE, 100 ether); q.mint(address(vault), 24e6);
        vault.fundToken(d, ID, q, 24e6); vm.warp(block.timestamp + 24 hours);
        assertEq(_claim(ALICE), 24e6); assertEq(q.balanceOf(ALICE), 24e6);
    }
    function test_unauthorizedAndInvalidBucketRejected() public {
        vm.expectRevert(HolderRewardsDistributorV1.Unauthorized.selector); d.fundCreatorFees{value: 1}(ID, 1, 1);
        vm.expectRevert(HolderRewardsDistributorV1.Unauthorized.selector); d.checkpointTransfer(ID, ALICE, BOB, 1);
        vm.prank(address(vault)); vm.expectRevert(HolderRewardsDistributorV1.InvalidFunding.selector);
        d.fundCreatorFees(ID, 2, 1);
        vm.expectRevert(HolderRewardsDistributorV1.InvalidMarket.selector); d.registerFeeSharingMarket(ID, address(vault), LOCKER);
    }
    function test_invalidTransferRevertsRewardChanges() public {
        _send(CURVE, ALICE, 100 ether); _fund(24 ether); vm.warp(block.timestamp + 12 hours);
        vm.prank(ALICE); vm.expectRevert(); token.transfer(BOB, 101 ether);
        assertApproxEqAbs(d.claimable(ID, ALICE), 12 ether, 1); assertEq(d.marketState(ID).supply, 100 ether);
    }
    function test_sharedAssetMarketsKeepIndependentLiabilitiesAndClaimRights() public {
        _send(CURVE, ALICE, 100 ether); _fund(24 ether);
        bytes32 otherId = keccak256("other-continuous-market");
        TickerMemeTokenV1 other = new TickerMemeTokenV1(otherId, address(this), CURVE, address(d), "Other", "O", "", 100 ether);
        value.config.memeToken = address(other); registry.set(value);
        d.registerFeeSharingMarket(otherId, address(vault), LOCKER);
        vm.prank(CURVE); other.transfer(BOB, 100 ether);
        vault.fund{value: 48 ether}(d, otherId);
        vm.warp(block.timestamp + 24 hours);
        assertEq(d.claimable(ID, BOB), 0); assertEq(d.claimable(otherId, ALICE), 0);
        assertEq(_claim(ALICE), 24 ether); assertEq(d.totalLiability(address(0)), 48 ether);
        vm.prank(BOB); assertEq(d.claim(otherId), 48 ether);
        assertEq(d.totalLiability(address(0)), 0);
    }
    function test_inexactQuoteFundingRollsBackEveryStreamAndBalance() public {
        MockFeeOnTransferQuoteToken q = new MockFeeOnTransferQuoteToken(6, 100);
        _deploy(address(q)); _send(CURVE, ALICE, 100 ether); q.mint(address(vault), 1e6);
        vm.expectRevert(HolderRewardsDistributorV1.InexactTransfer.selector);
        vault.fundToken(d, ID, q, 1e6);
        assertEq(q.balanceOf(address(vault)), 1e6); assertEq(q.balanceOf(address(d)), 0);
        assertEq(d.marketState(ID).count, 0); assertEq(d.totalLiability(address(q)), 0);
    }
    function test_nativeRecipientCannotReenterAndClaimTwice() public {
        ContinuousReentrantReceiver r = new ContinuousReentrantReceiver();
        _send(CURVE, address(r), 100 ether); _fund(24 ether); vm.warp(block.timestamp + 24 hours);
        r.claim(d, ID); assertFalse(r.nestedSucceeded());
        assertEq(address(r).balance, 24 ether); assertEq(d.totalLiability(address(0)), 0);
    }
    function test_all64ExpiriesRemainWithinBoundedTransferGas() public {
        _send(CURVE, ALICE, 100 ether);
        for (uint256 i; i < 64; ++i) { _fund(1 ether); vm.warp(block.timestamp + 1); }
        vm.warp(block.timestamp + 24 hours);
        uint256 beforeGas = gasleft(); _send(ALICE, BOB, 1 ether); uint256 used = beforeGas - gasleft();
        emit log_named_uint("transfer gas with 64 expired streams", used);
        assertLt(used, 2_000_000); assertEq(d.marketState(ID).count, 0);
        assertEq(d.claimable(ID, BOB), 0); assertEq(_claim(ALICE), 64 ether);
    }
    function testFuzz_manyTransfersMatchIndependentPiecewiseIntegral(uint256 seed) public {
        _send(CURVE, ALICE, 100 ether); _fund(86400 ether);
        uint256 expectedA; uint256 expectedB; uint256 balanceA = 100; uint256 paidA; uint256 paidB;
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
            if (seed % 3 == 0) { paidA += _claim(ALICE); paidB += _claim(BOB); }
            assertEq(d.marketState(ID).supply, 100 ether);
        }
        paidA += _claim(ALICE); paidB += _claim(BOB);
        assertEq(paidA, expectedA); assertEq(paidB, expectedB);
        assertEq(paidA + paidB, 86400 ether); assertEq(d.totalLiability(address(0)), 0);
    }
    function testFuzz_twoHolderTimeIntegral(uint96 amountRaw, uint32 elapsedRaw, uint16 shareRaw) public {
        uint256 amount = bound(uint256(amountRaw), 1 ether, 1000 ether);
        uint256 elapsed = bound(uint256(elapsedRaw), 0, 86400);
        uint256 share = bound(uint256(shareRaw), 1, 99);
        _send(CURVE, ALICE, 100 ether); _fund(amount);
        vm.warp(block.timestamp + elapsed); _send(ALICE, BOB, share * 1 ether);
        vm.warp(block.timestamp + 86400 - elapsed);
        uint256 paidA = _claim(ALICE); uint256 paidB = _claim(BOB);
        uint256 expectedB = amount * (86400 - elapsed) * share / 86400 / 100;
        assertApproxEqAbs(paidB, expectedB, 2);
        assertApproxEqAbs(paidA, amount - expectedB, 2);
        assertLe(paidA + paidB, amount); assertLe(amount - paidA - paidB, 2);
    }
}
