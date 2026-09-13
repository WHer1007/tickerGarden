// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Vm} from "forge-std/Vm.sol";
import {ContinuousHolderFeeFlowTest} from "./ContinuousHolderFeeFlow.t.sol";
import {MockExactQuoteToken, MockFeeOnTransferQuoteToken} from "../mocks/MockV1QuoteAssets.sol";
import {TickerMemeTokenV1} from "../../../src/v1/modules/TickerMemeTokenV1.sol";
import {ProtocolFeeVaultUserClaims} from "../../../src/v1/shared/ProtocolFeeVaultUserClaims.sol";
import {HolderRewardsDistributorV1} from "../../../src/v1/modules/HolderRewardsDistributorV1.sol";
import {MarketView} from "../../../src/v1/interfaces/IV1Protocol.sol";

contract BatchFaultQuote is MockExactQuoteToken {
    uint8 public mode;
    address public callbackVault;
    bytes32 public callbackMarket;
    bool public nestedSucceeded;
    bytes4 public nestedError;
    constructor() MockExactQuoteToken(18) {}

    function configure(uint8 nextMode, address v, bytes32 id) external {
        mode = nextMode;
        callbackVault = v;
        callbackMarket = id;
    }

    function _transfer(address from, address to, uint256 amount) internal override {
        if (mode == 1) {
            assembly ("memory-safe") { invalid() }
        }
        if (mode == 2) {
            assembly {
                mstore(0, shl(224, 0xdeadbeef))
                revert(0, 131072)
            }
        }
        if (mode == 3) {
            bytes32[] memory ids = new bytes32[](1);
            ids[0] = callbackMarket;
            bytes memory reason;
            (nestedSucceeded, reason) = callbackVault.call(
                abi.encodeWithSignature(
                    "fundHolderRewardsBatch(bytes32[],uint8,uint256)", ids, uint8(3), uint256(500000)
                )
            );
            nestedError = bytes4(reason);
            require(!nestedSucceeded, "BATCH_REENTERED");
        }
        super._transfer(from, to, amount);
    }
}

contract HolderBatchFundingTest is ContinuousHolderFeeFlowTest {
    uint256 constant ITEM_GAS = 500_000;
    bytes32 constant RESULT = keccak256("HolderFundingResult(bytes32,uint8,uint8,uint256,bytes4)");

    function _ids(bytes32 first) internal pure returns (bytes32[] memory ids) {
        ids = new bytes32[](1);
        ids[0] = first;
    }

    function _seedMeme(uint256 amount) internal {
        meme.transfer(address(vault), amount);
        vault.seedHolder(ID, 1, address(meme), amount);
    }

    function _addMarket(bytes32 id, address asset, uint256 q, uint256 m) internal returns (TickerMemeTokenV1 token) {
        token = new TickerMemeTokenV1(id, CREATOR, address(this), address(rewards), "Batch", "B", "", 1000 ether);
        MarketView memory v = value;
        v.config.memeToken = address(token);
        v.config.quoteAsset = asset;
        registry.setMarket(id, v);
        rewards.registerFeeSharingMarket(id, address(vault), address(0x456));
        if (q != 0) {
            if (asset == address(0)) vm.deal(address(vault), address(vault).balance + q);
            else MockExactQuoteToken(asset).mint(address(vault), q);
            vault.seedHolder(id, 1, asset, q);
        }
        if (m != 0) {
            token.transfer(address(vault), m);
            vault.seedHolder(id, 1, address(token), m);
        }
    }

    function _assertResult(Vm.Log memory entry, bytes32 id, uint8 asset, uint8 status, uint256 amount) internal view {
        assertEq(entry.emitter, address(vault));
        assertEq(entry.topics[0], RESULT);
        assertEq(entry.topics[1], id);
        assertEq(uint256(entry.topics[2]), asset);
        (uint8 actualStatus, uint256 actualAmount,) = abi.decode(entry.data, (uint8, uint256, bytes4));
        assertEq(actualStatus, status);
        assertEq(actualAmount, amount);
    }

    function test_batchBothAssetsAndDuplicateNeverDoubleFunds() public {
        _credit(100_000_000, 10_000_000);
        _seedMeme(10 ether);
        uint256 q = vault.holderLiability(ID, 1, address(quote));
        uint256 creator = vault.creatorLiability(ID, 1, address(quote));
        uint256 platform = vault.liability(ID, address(quote), 2);
        bytes32[] memory ids = new bytes32[](2);
        ids[0] = ID;
        ids[1] = ID;
        vm.prank(ALICE);
        (uint256 next, uint8 asset) = vault.fundHolderRewardsBatch(ids, 3, ITEM_GAS);
        assertEq(next, 2);
        assertEq(asset, 0);
        assertEq(rewards.marketState(ID).unallocatedQuote, q);
        assertEq(rewards.marketState(ID).unallocatedMeme, 10 ether);
        assertEq(vault.creatorLiability(ID, 1, address(quote)), creator);
        assertEq(vault.liability(ID, address(quote), 2), platform);
        assertEq(vault.totalLiability(address(quote)), creator + platform);
        assertEq(quote.allowance(address(vault), address(rewards)), 0);
        assertEq(quote.balanceOf(ALICE), 0);
        vault.fundHolderRewardsBatch(ids, 3, ITEM_GAS);
        assertEq(rewards.marketState(ID).unallocatedQuote, q);
        vm.prank(CREATOR);
        vault.claimUserRewardAssets(ID, 0, 1, 1);
        vault.claimPlatform(ID, address(quote));
        assertEq(vault.totalLiability(address(quote)), 0);
    }

    function test_batchQuoteAndMemeSelectionsAreIndependent() public {
        _credit(1_000_000, 0);
        _seedMeme(1 ether);
        vault.fundHolderRewardsBatch(_ids(ID), 2, ITEM_GAS);
        assertGt(vault.holderLiability(ID, 1, address(quote)), 0);
        assertEq(rewards.marketState(ID).unallocatedQuote, 0);
        assertEq(rewards.marketState(ID).unallocatedMeme, 1 ether);
        vault.fundHolderRewardsBatch(_ids(ID), 1, ITEM_GAS);
        assertEq(vault.holderLiability(ID, 1, address(quote)), 0);
    }

    function test_zeroBalanceSkipsBrokenAssetBalanceReads() public {
        vm.mockCallRevert(
            address(quote), abi.encodeWithSelector(quote.balanceOf.selector, address(vault)), "BROKEN_BALANCE"
        );
        vm.recordLogs();
        vault.fundHolderRewardsBatch(_ids(ID), 1, ITEM_GAS);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        assertEq(logs.length, 1);
        _assertResult(logs[0], ID, 1, 0, 0);
    }

    function test_invalidMarketDoesNotBlockLaterNativeAndErc20Markets() public {
        _credit(1_000_000, 0);
        bytes32 nativeId = keccak256("native");
        _addMarket(nativeId, address(0), 1 ether, 0);
        bytes32[] memory ids = new bytes32[](3);
        ids[0] = bytes32(0);
        ids[1] = nativeId;
        ids[2] = ID;
        vm.recordLogs();
        (uint256 next,) = vault.fundHolderRewardsBatch(ids, 1, ITEM_GAS);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        _assertResult(logs[0], bytes32(0), 1, 2, 0);
        assertEq(next, 3);
        assertEq(rewards.marketState(nativeId).unallocatedQuote, 1 ether);
        assertGt(rewards.marketState(ID).unallocatedQuote, 0);
    }

    function test_insolventQuotePreservesItsRightsAndFundsMeme() public {
        _credit(1_000_000, 0);
        _seedMeme(1 ether);
        uint256 due = vault.holderLiability(ID, 1, address(quote));
        vm.mockCall(
            address(quote), abi.encodeWithSelector(quote.balanceOf.selector, address(vault)), abi.encode(uint256(0))
        );
        vault.fundHolderRewardsBatch(_ids(ID), 3, ITEM_GAS);
        assertEq(vault.holderLiability(ID, 1, address(quote)), due);
        assertEq(rewards.marketState(ID).unallocatedQuote, 0);
        assertEq(rewards.marketState(ID).unallocatedMeme, 1 ether);
        vm.clearMockedCalls();
        vault.fundHolderRewardsBatch(_ids(ID), 1, ITEM_GAS);
        assertEq(rewards.marketState(ID).unallocatedQuote, due);
    }

    function test_cleanupFailureRollsBackTransferDistributorCreditAndApproval() public {
        _credit(1_000_000, 0);
        _seedMeme(1 ether);
        uint256 beforeBalance = quote.balanceOf(address(vault));
        uint256 due = vault.holderLiability(ID, 1, address(quote));
        vm.mockCallRevert(
            address(quote), abi.encodeWithSelector(quote.approve.selector, address(rewards), 0), "CLEANUP_FAIL"
        );
        vault.fundHolderRewardsBatch(_ids(ID), 3, ITEM_GAS);
        assertEq(quote.balanceOf(address(vault)), beforeBalance);
        assertEq(quote.balanceOf(address(rewards)), 0);
        assertEq(quote.allowance(address(vault), address(rewards)), 0);
        assertEq(rewards.totalLiability(address(quote)), 0);
        assertEq(vault.holderLiability(ID, 1, address(quote)), due);
        assertEq(rewards.marketState(ID).unallocatedMeme, 1 ether);
        vm.clearMockedCalls();
        vault.fundHolderRewards(ID, 1); // Shared operation guard also recovered.
        assertEq(rewards.marketState(ID).unallocatedQuote, due);
    }

    function _faultThenHealthy(uint8 mode) internal {
        BatchFaultQuote bad = new BatchFaultQuote();
        bytes32 badId = keccak256(abi.encode("bad", mode));
        _addMarket(badId, address(bad), 1 ether, 0);
        bad.configure(mode, address(vault), ID);
        _credit(1_000_000, 0);
        bytes32[] memory ids = new bytes32[](2);
        ids[0] = badId;
        ids[1] = ID;
        vm.recordLogs();
        (uint256 next,) = vault.fundHolderRewardsBatch{gas: 1_500_000}(ids, 1, ITEM_GAS);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        assertEq(next, 2);
        _assertResult(logs[0], badId, 1, 2, 0);
        if (mode == 2) {
            (,, bytes4 reason) = abi.decode(logs[0].data, (uint8, uint256, bytes4));
            assertEq(reason, bytes4(0xdeadbeef));
        }
        assertEq(bad.allowance(address(vault), address(rewards)), 0);
        assertEq(bad.balanceOf(address(vault)), 1 ether);
        assertEq(vault.holderLiability(badId, 1, address(bad)), 1 ether);
        assertEq(rewards.marketState(badId).unallocatedQuote, 0);
        assertGt(rewards.marketState(ID).unallocatedQuote, 0);
        bad.configure(0, address(0), bytes32(0));
        vault.fundHolderRewardsBatch(_ids(badId), 1, ITEM_GAS);
        assertEq(rewards.marketState(badId).unallocatedQuote, 1 ether);
    }

    function test_gasExhaustingAssetDoesNotBlockLaterHealthyMarket() public {
        _faultThenHealthy(1);
    }

    function test_largeRevertDataDoesNotBombParentBatch() public {
        _faultThenHealthy(2);
    }

    function test_tokenCallbackCannotReenterBatch() public {
        BatchFaultQuote asset = new BatchFaultQuote();
        bytes32 id = keccak256("reenter");
        _addMarket(id, address(asset), 1 ether, 0);
        _credit(1_000_000, 0);
        asset.configure(3, address(vault), ID);
        vault.fundHolderRewardsBatch(_ids(id), 1, ITEM_GAS);
        assertFalse(asset.nestedSucceeded());
        assertEq(asset.nestedError(), bytes4(keccak256("FeeCreditNotPrepared(bytes32)")));
        assertEq(rewards.marketState(id).unallocatedQuote, 1 ether);
        assertEq(rewards.marketState(ID).unallocatedQuote, 0);
    }

    function test_lowGasReturnsCursorWithoutLosingEarlierFunding() public {
        BatchFaultQuote bad = new BatchFaultQuote();
        bytes32 badId = keccak256("gas-stop");
        _addMarket(badId, address(bad), 1 ether, 0);
        bad.configure(1, address(0), bytes32(0));
        _credit(1_000_000, 0);
        bytes32[] memory ids = new bytes32[](3);
        ids[0] = ID;
        ids[1] = badId;
        ids[2] = ID;
        (uint256 next, uint8 asset) = vault.fundHolderRewardsBatch{gas: 950_000}(ids, 1, ITEM_GAS);
        assertEq(next, 2);
        assertEq(asset, 1);
        assertGt(rewards.marketState(ID).unallocatedQuote, 0);
        assertEq(vault.holderLiability(badId, 1, address(bad)), 1 ether);
        (next, asset) = vault.fundHolderRewardsBatch(_ids(ID), 1, ITEM_GAS);
        assertEq(next, 1);
        assertEq(asset, 0);
    }

    function test_lowGasBeforeFirstItemTransfersNothing() public {
        _credit(1_000_000, 0);
        (uint256 next, uint8 asset) = vault.fundHolderRewardsBatch{gas: 150_000}(_ids(ID), 3, ITEM_GAS);
        assertEq(next, 0);
        assertEq(asset, 1);
        assertEq(rewards.marketState(ID).unallocatedQuote, 0);
        assertGt(vault.holderLiability(ID, 1, address(quote)), 0);
    }

    function test_lowGasCanResumeAtMemeAfterQuoteSucceeded() public {
        _credit(1_000_000, 0);
        _seedMeme(1 ether);
        (uint256 next, uint8 asset) = vault.fundHolderRewardsBatch{gas: 650_000}(_ids(ID), 3, ITEM_GAS);
        assertEq(next, 0);
        assertEq(asset, 2);
        assertGt(rewards.marketState(ID).unallocatedQuote, 0);
        assertEq(rewards.marketState(ID).unallocatedMeme, 0);
        (next, asset) = vault.fundHolderRewardsBatch(_ids(ID), 2, ITEM_GAS);
        assertEq(next, 1);
        assertEq(asset, 0);
        assertEq(rewards.marketState(ID).unallocatedMeme, 1 ether);
    }

    function test_inexactAssetTransferRollsBackButItsMemeStillFunds() public {
        MockFeeOnTransferQuoteToken taxToken = new MockFeeOnTransferQuoteToken(18, 100);
        bytes32 id = keccak256("inexact");
        TickerMemeTokenV1 token = _addMarket(id, address(taxToken), 1 ether, 2 ether);
        vault.fundHolderRewardsBatch(_ids(id), 3, ITEM_GAS);
        assertEq(taxToken.balanceOf(address(vault)), 1 ether);
        assertEq(taxToken.balanceOf(address(rewards)), 0);
        assertEq(taxToken.allowance(address(vault), address(rewards)), 0);
        assertEq(vault.holderLiability(id, 1, address(taxToken)), 1 ether);
        assertEq(rewards.marketState(id).unallocatedMeme, 2 ether);
        assertEq(token.balanceOf(address(rewards)), 2 ether);
    }

    function test_batchFundsThenSeparateSnapshotOpensClaims() public {
        _credit(1_000_000, 0);
        _seedMeme(1 ether);
        uint256 due = vault.holderLiability(ID, 1, address(quote));
        vault.fundHolderRewardsBatch(_ids(ID), 3, ITEM_GAS);
        assertEq(rewards.roundState(ID, 1).root, bytes32(0));
        vm.expectRevert(HolderRewardsDistributorV1.InvalidClaim.selector);
        vm.prank(ALICE);
        rewards.claimSnapshot(ID, 1, due, 1 ether, 3, new bytes32[](0));
        vm.roll(block.number + 2);
        vm.setBlockhash(block.number - 1, keccak256("batch-claim"));
        bytes32 leaf = rewards.claimLeaf(ID, 1, ALICE, due, 1 ether);
        HolderRewardsDistributorV1.Publication[] memory publications = new HolderRewardsDistributorV1.Publication[](1);
        publications[0] = HolderRewardsDistributorV1.Publication(
            ID, 1, uint64(block.number - 1), blockhash(block.number - 1), leaf, keccak256("batch-data"), due, 1 ether
        );
        rewards.publishSnapshots(publications);
        uint256 beforeMeme = meme.balanceOf(ALICE);
        vm.prank(ALICE);
        rewards.claimSnapshot(ID, 1, due, 1 ether, 3, new bytes32[](0));
        assertEq(quote.balanceOf(ALICE), due);
        assertEq(meme.balanceOf(ALICE), beforeMeme + 1 ether);
        assertEq(rewards.totalLiability(address(quote)), 0);
        assertEq(rewards.totalLiability(address(meme)), 0);
    }

    function test_rejectsUnboundedInputsBeforeMutations() public {
        vm.expectRevert(ProtocolFeeVaultUserClaims.InvalidHolderFundingBatch.selector);
        vault.fundHolderRewardsBatch(new bytes32[](33), 3, ITEM_GAS);
        vm.expectRevert(ProtocolFeeVaultUserClaims.InvalidHolderFundingBatch.selector);
        vault.fundHolderRewardsBatch(new bytes32[](0), 3, ITEM_GAS);
        vm.expectRevert(ProtocolFeeVaultUserClaims.InvalidHolderFundingBatch.selector);
        vault.fundHolderRewardsBatch(_ids(ID), 0, ITEM_GAS);
        vm.expectRevert(ProtocolFeeVaultUserClaims.InvalidHolderFundingBatch.selector);
        vault.fundHolderRewardsBatch(_ids(ID), 4, ITEM_GAS);
        vm.expectRevert(ProtocolFeeVaultUserClaims.InvalidHolderFundingBatch.selector);
        vault.fundHolderRewardsBatch(_ids(ID), 3, 99_999);
        vm.expectRevert(ProtocolFeeVaultUserClaims.InvalidHolderFundingBatch.selector);
        vault.fundHolderRewardsBatch(_ids(ID), 3, 2_000_001);
    }

    function test_batchAtMaximumMarketCountFundsAllWithoutCrossMarketMixing() public {
        bytes32[] memory ids = new bytes32[](32);
        for (uint256 i; i < ids.length; ++i) {
            ids[i] = keccak256(abi.encode("capacity", i));
            _addMarket(ids[i], address(quote), (i + 1) * 1000, 1 ether);
        }
        // Cool account/storage accesses; this is still a local fixture, not a production transaction.
        for (uint256 i; i < ids.length; ++i) {
            vm.cool(registry.market(ids[i]).config.memeToken);
        }
        vm.cool(address(vault));
        vm.cool(address(rewards));
        vm.cool(address(registry));
        vm.cool(address(quote));
        uint256 beforeGas = gasleft();
        (uint256 next, uint8 asset) = vault.fundHolderRewardsBatch{gas: 15_000_000}(ids, 3, ITEM_GAS);
        emit log_named_uint("32 markets cold dual asset batch execution gas", beforeGas - gasleft());
        assertEq(next, 32);
        assertEq(asset, 0);
        for (uint256 i; i < ids.length; ++i) {
            assertEq(rewards.marketState(ids[i]).unallocatedQuote, (i + 1) * 1000);
            assertEq(rewards.marketState(ids[i]).unallocatedMeme, 1 ether);
            assertEq(vault.holderLiability(ids[i], 1, address(quote)), 0);
        }
        assertEq(vault.totalLiability(address(quote)), 0);
    }

    function testFuzz_batchAndSingleFundingConserveSameEntitlement(uint96 input, uint8 maskInput) public {
        uint256 amount = bound(uint256(input), 1, 1e24);
        uint8 mask = uint8(bound(uint256(maskInput), 1, 3));
        bytes32 a = keccak256("fuzz-a");
        bytes32 b = keccak256("fuzz-b");
        _addMarket(a, address(quote), amount, 1 ether);
        _addMarket(b, address(quote), amount, 1 ether);
        vault.fundHolderRewardsBatch(_ids(a), mask, ITEM_GAS);
        if (mask & 1 != 0) vault.fundHolderRewards(b, 1);
        if (mask & 2 != 0) vault.fundHolderMemeRewards(b);
        assertEq(rewards.marketState(a).unallocatedQuote, rewards.marketState(b).unallocatedQuote);
        assertEq(rewards.marketState(a).unallocatedMeme, rewards.marketState(b).unallocatedMeme);
        assertEq(vault.holderLiability(a, 1, address(quote)), vault.holderLiability(b, 1, address(quote)));
    }
}
