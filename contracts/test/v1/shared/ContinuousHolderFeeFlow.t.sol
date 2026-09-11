// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;
import {Test} from "forge-std/Test.sol";
import {
    HolderFeeRegistryMock,
    HolderFeeCreatorMock,
    HolderFeeVaultHarness,
    HolderFeeHookMock
} from "./HolderFeeSharing.t.sol";
import {MockExactQuoteToken} from "../mocks/MockV1QuoteAssets.sol";
import {HolderAccountingHarness as HolderRewardsDistributorV1} from "../mocks/HolderAccountingHarness.sol";
import {TickerMemeTokenV1} from "../../../src/v1/modules/TickerMemeTokenV1.sol";
import {MarketView} from "../../../src/v1/interfaces/IV1Protocol.sol";

contract ContinuousHolderFeeFlowTest is Test {
    bytes32 constant ID = keccak256("continuous-fee-flow");
    address constant ALICE = address(0xA11CE);
    address constant CREATOR = address(0xC123);
    HolderFeeRegistryMock registry;
    HolderFeeVaultHarness vault;
    HolderRewardsDistributorV1 rewards;
    MockExactQuoteToken quote;
    TickerMemeTokenV1 meme;
    MarketView value;
    uint64 nonce;

    function setUp() public {
        registry = new HolderFeeRegistryMock(address(this));
        rewards = new HolderRewardsDistributorV1(address(registry));
        HolderFeeCreatorMock creators = new HolderFeeCreatorMock();
        creators.setEpoch(ID, 1, CREATOR);
        vault = new HolderFeeVaultHarness(address(registry), address(creators), address(this), keccak256("policy"));
        quote = new MockExactQuoteToken(6);
        meme = new TickerMemeTokenV1(ID, CREATOR, address(this), address(rewards), "Garden", "G", "", 1000 ether);
        HolderFeeHookMock hook =
            new HolderFeeHookMock(address(0x123), address(vault), MockExactQuoteToken(address(meme)), quote);
        value.config.memeToken = address(meme);
        value.config.quoteAsset = address(quote);
        value.config.curve = address(this);
        value.config.graduatedHook = address(hook);
        value.config.creatorFeesToHolders = true; // staking deliberately disabled
        value.config.creatorTaxBps = 500;
        value.runtime.sourceVersion = 1;
        registry.setMarket(ID, value);
        rewards.registerFeeSharingMarket(ID, address(vault), address(0x456));
        meme.transfer(ALICE, 100 ether);
    }

    function _credit(uint256 total, uint256 tax) internal {
        ++nonce;
        bytes32 feeId = keccak256(
            abi.encode(
                keccak256("TICKERGARDEN_V1_CURVE_SWEEP"),
                uint256(1),
                block.chainid,
                address(vault),
                address(this),
                ID,
                uint32(1),
                nonce,
                address(quote),
                total,
                tax
            )
        );
        vault.beginCurveCredit(ID, address(quote), total, tax, 1, nonce, feeId);
        quote.mint(address(vault), total);
        vault.finalizeCurveCredit(ID, address(quote), total, tax, 1, nonce, feeId);
    }

    function test_curveCreditKeepsBeginFinalizeChecksWithoutThirdMarketRead() public {
        vm.expectCall(address(registry), abi.encodeWithSelector(registry.market.selector, ID), uint64(2));
        _credit(100_000_000, 10_000_000);
    }

    function test_baseSplitTaxAndPermissionlessFundingThroughRealVault() public {
        _credit(100_000_000, 10_000_000);
        uint256 holder = vault.holderLiability(ID, 1, address(quote));
        uint256 creator = vault.creatorLiability(ID, 1, address(quote));
        assertGt(holder, 0);
        // With staking disabled, creator base is unchanged at 70%; its half goes to holders.
        assertEq(holder, 31_500_000);
        assertEq(creator, 41_500_000);
        vm.prank(ALICE);
        assertEq(vault.fundHolderRewards(ID, 1), holder);
        assertEq(vault.holderLiability(ID, 1, address(quote)), 0);
        assertEq(rewards.claimable(ID, ALICE), 0);
        vm.prank(CREATOR);
        (uint256 paid,,) = vault.claimUserRewards(ID, 0, 1, false, false, block.timestamp + 240);
        assertEq(paid, creator);
        vm.warp(block.timestamp + 24 hours);
        vm.prank(ALICE);
        assertEq(rewards.claim(ID), holder);
        assertEq(quote.balanceOf(ALICE), holder);
        assertEq(quote.balanceOf(CREATOR), creator);
    }

    function test_publicFragmentedFundingPreservesLiabilitiesAndNeverHitsCapacity() public {
        uint256 total;
        for (uint256 i; i < 100; ++i) {
            _credit(1000, 0);
            total += vault.fundHolderRewards(ID, 1);
            vm.warp(block.timestamp + 1);
        }
        assertEq(vault.holderLiability(ID, 1, address(quote)), 0);
        assertEq(quote.allowance(address(vault), address(rewards)), 0);
        assertEq(rewards.marketState(ID).count, 1);
        assertEq(rewards.totalLiability(address(quote)), total);
        vm.warp(block.timestamp + 4 hours);
        rewards.checkpoint(ID);
        vm.warp(block.timestamp + 24 hours);
        vm.prank(ALICE);
        assertEq(rewards.claim(ID), total);
    }
}
