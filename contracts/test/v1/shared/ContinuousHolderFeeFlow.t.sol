// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;
import {Test} from "forge-std/Test.sol";
import {HolderFeeRegistryMock, HolderFeeCreatorMock, HolderFeeVaultHarness, HolderFeeHookMock} from "./HolderFeeSharing.t.sol";
import {MockExactQuoteToken} from "../mocks/MockV1QuoteAssets.sol";
import {HolderRewardsDistributorV1} from "../../../src/v1/modules/HolderRewardsDistributorV1.sol";
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
        HolderFeeHookMock hook = new HolderFeeHookMock(address(0x123), address(vault), MockExactQuoteToken(address(meme)), quote);
        value.config.memeToken = address(meme); value.config.quoteAsset = address(quote);
        value.config.curve = address(this); value.config.graduatedHook = address(hook);
        value.config.creatorFeesToHolders = true; // staking deliberately disabled
        value.config.creatorTaxBps = 500; value.runtime.sourceVersion = 1;
        registry.setMarket(ID, value);
        rewards.registerFeeSharingMarket(ID, address(vault), address(0x456));
        meme.transfer(ALICE, 100 ether);
    }
    function _credit(uint256 total, uint256 tax) internal {
        ++nonce;
        bytes32 feeId = keccak256(abi.encode(keccak256("TICKERGARDEN_V1_CURVE_SWEEP"), uint256(1), block.chainid,
            address(vault), address(this), ID, uint32(1), nonce, address(quote), total, tax));
        vault.beginCurveCredit(ID, address(quote), total, tax, 1, nonce, feeId);
        quote.mint(address(vault), total);
        vault.finalizeCurveCredit(ID, address(quote), total, tax, 1, nonce, feeId);
    }
    function test_baseSplitTaxAndPermissionlessFundingThroughRealVault() public {
        _credit(100_000_000, 10_000_000);
        uint256 holder = vault.holderLiability(ID, 1, address(quote));
        uint256 creator = vault.creatorLiability(ID, 1, address(quote));
        assertGt(holder, 0);
        // With staking disabled, creator base is unchanged at 70%; its half goes to holders.
        assertEq(holder, 31_500_000); assertEq(creator, 41_500_000);
        vm.prank(ALICE); assertEq(vault.fundHolderRewards(ID, 1), holder);
        assertEq(vault.holderLiability(ID, 1, address(quote)), 0);
        assertEq(rewards.claimable(ID, ALICE), 0);
        vm.prank(CREATOR); assertEq(vault.claimCreator(ID, 1, address(quote)), creator);
        vm.warp(block.timestamp + 24 hours);
        vm.prank(ALICE); assertEq(rewards.claim(ID), holder);
        assertEq(quote.balanceOf(ALICE), holder);
        assertEq(quote.balanceOf(CREATOR), creator);
    }
    function test_memeConversionThenFundingStartsReleaseOnlyOnActualFunding() public {
        value.runtime.launchPhase = 1; registry.setMarket(ID, value);
        meme.transfer(address(vault), 1000);
        vault.seedHolder(ID, 1, address(meme), 1000);
        (uint256 spent, uint256 received) = vault.settleHolderRewards(ID, 1, 1000, 2000, block.timestamp + 300);
        assertEq(spent, 1000); assertEq(received, 2000);
        vm.warp(block.timestamp + 3 days);
        assertEq(rewards.claimable(ID, ALICE), 0);
        vault.fundHolderRewards(ID, 1);
        assertEq(rewards.claimable(ID, ALICE), 0);
        vm.warp(block.timestamp + 24 hours);
        vm.prank(ALICE); assertEq(rewards.claim(ID), 2000);
    }
    function test_capacityRevertPreservesVaultLiabilityAndAllowanceThenRetries() public {
        for (uint256 i; i < 64; ++i) {
            _credit(1000, 0); vault.fundHolderRewards(ID, 1); vm.warp(block.timestamp + 1);
        }
        _credit(1000, 0);
        uint256 beforeBalance = quote.balanceOf(address(vault));
        uint256 liability = vault.holderLiability(ID, 1, address(quote));
        vm.expectRevert(HolderRewardsDistributorV1.StreamCapacity.selector);
        vault.fundHolderRewards(ID, 1);
        assertEq(quote.balanceOf(address(vault)), beforeBalance);
        assertEq(vault.holderLiability(ID, 1, address(quote)), liability);
        assertEq(quote.allowance(address(vault), address(rewards)), 0);
        vm.warp(block.timestamp + 24 hours);
        assertEq(vault.fundHolderRewards(ID, 1), liability);
    }
}
