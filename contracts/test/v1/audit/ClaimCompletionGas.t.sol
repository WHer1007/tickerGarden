// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {UserClaimHarness} from "../shared/UserRewardClaims.t.sol";
import {
    RewardSettlementRegistryMock,
    RewardSettlementCreatorMock,
    RewardSettlementPoolManagerMock
} from "../shared/RewardSettlement.t.sol";
import {HolderFeeRegistryMock, HolderFeeCreatorMock, HolderFeeVaultHarness} from "../shared/HolderFeeSharing.t.sol";
import {MockExactQuoteToken} from "../mocks/MockV1QuoteAssets.sol";
import {HolderRewardsDistributorV1} from "../../../src/v1/modules/HolderRewardsDistributorV1.sol";
import {TickerMemeTokenV1} from "../../../src/v1/modules/TickerMemeTokenV1.sol";
import {MockGaugeModuleCaller} from "../product/MemeStockGauge.t.sol";
import {MemeStockGauge} from "../../../src/v1/modules/MemeStockGauge.sol";
import {MemeStockGaugeClone} from "../../../src/v1/shared/MemeStockGaugeClone.sol";
import {MarketView, GaugeIdentity} from "../../../src/v1/interfaces/IV1Protocol.sol";

contract CompletionGasHook {
    address public immutable protocolFeeVault;
    address public constant poolManager = address(0x123);

    constructor(address vault) {
        protocolFeeVault = vault;
    }

    function convertRewards(bytes32, uint256, uint256) external pure returns (uint256, uint256) {
        assembly { invalid() }
    }
}

contract ClaimCompletionGasTest is Test {
    bytes32 constant ID = keccak256("completion-gas");
    address constant ALICE = address(0xa11ce);
    address constant BOB = address(0xb0b);

    struct OwnerFixture {
        MockExactQuoteToken meme;
        MockExactQuoteToken quote;
        RewardSettlementRegistryMock registry;
        RewardSettlementCreatorMock creators;
        MemeStockGauge gauge;
        MockGaugeModuleCaller manager;
        UserClaimHarness vault;
        CompletionGasHook hook;
    }

    struct HolderFixture {
        HolderFeeRegistryMock registry;
        HolderRewardsDistributorV1 rewards;
        HolderFeeCreatorMock creators;
        HolderFeeVaultHarness vault;
        MockExactQuoteToken quote;
        TickerMemeTokenV1 meme;
        CompletionGasHook hook;
    }

    function test_creatorGasExhaustionMatrix() public {
        _ownerMatrix(0);
    }

    function test_realStakerGasExhaustionMatrix() public {
        _ownerMatrix(1);
    }

    function _ownerMatrix(uint8 role) private {
        for (uint256 i; i < 8; ++i) {
            bool nativeQuote = i & 1 != 0;
            bool raw = i & 2 != 0;
            bool cold = i & 4 != 0;
            uint256 snapshot = vm.snapshotState();
            OwnerFixture memory f;
            f.meme = new MockExactQuoteToken(18);
            f.quote = new MockExactQuoteToken(18);
            address asset = nativeQuote ? address(0) : address(f.quote);
            f.registry = new RewardSettlementRegistryMock();
            f.creators = new RewardSettlementCreatorMock();
            f.creators.setEpoch(ID, 1, ALICE);
            f.creators.setEpoch(ID, 2, BOB);
            f.vault = new UserClaimHarness(
                address(f.registry), address(new RewardSettlementPoolManagerMock()), address(f.creators)
            );
            f.manager = new MockGaugeModuleCaller();
            f.gauge = MemeStockGauge(
                MemeStockGaugeClone.deployDeterministic(
                    address(new MemeStockGauge()),
                    ID,
                    GaugeIdentity(
                        ID,
                        keccak256("stock"),
                        keccak256("quote"),
                        address(f.manager),
                        address(f.vault),
                        asset,
                        address(f.meme)
                    )
                )
            );
            f.hook = new CompletionGasHook(address(f.vault));
            f.registry.configure(ID, address(f.hook), asset, address(f.meme), address(f.gauge));
            f.meme.mint(address(f.vault), 200);
            if (nativeQuote) vm.deal(address(f.vault), 60);
            else f.quote.mint(address(f.vault), 60);
            f.vault.seed(ID, 1, asset, 30, role == 0);
            f.vault.seed(ID, 1, address(f.meme), 100, role == 0);
            f.vault.seed(ID, 2, asset, 30, true);
            f.vault.seed(ID, 2, address(f.meme), 100, true);
            if (role == 1) {
                f.manager.add(f.gauge, ALICE, 100, uint64(block.timestamp + 30), uint64(block.timestamp + 24 hours));
                vm.warp(block.timestamp + 24 hours);
                vm.startPrank(address(f.vault));
                f.gauge.creditStakerFee(asset, 30, keccak256("quote-fee"));
                f.gauge.creditStakerFee(address(f.meme), 100, keccak256("meme-fee"));
                vm.stopPrank();
            }
            if (cold) {
                vm.cool(address(f.vault));
                vm.cool(address(f.registry));
                vm.cool(address(f.creators));
                vm.cool(address(f.manager));
                vm.cool(address(f.gauge));
                vm.cool(address(f.meme));
                vm.cool(address(f.quote));
                vm.cool(address(f.hook));
            }
            // Ensure the stress call actually happens, rather than the low-budget skip branch.
            vm.expectCall(
                address(f.hook),
                abi.encodeWithSignature("convertRewards(bytes32,uint256,uint256)", ID, 100, block.timestamp + 240)
            );
            vm.prank(ALICE);
            (bool ok, bytes memory result) = address(f.vault).call{gas: 1_500_000}(
                abi.encodeCall(
                    f.vault.claimUserRewards,
                    (ID, role, role == 0 ? uint32(1) : uint32(0), true, raw, block.timestamp + 240)
                )
            );
            assertTrue(ok, "owner completion survives exhausting conversion");
            _assertResult(result, 30, 100, raw);
            assertEq(nativeQuote ? ALICE.balance : f.quote.balanceOf(ALICE), 30);
            assertEq(f.meme.balanceOf(ALICE), raw ? 100 : 0);
            assertEq(f.vault.creatorLiability(ID, 2, asset), 30);
            assertEq(f.vault.creatorLiability(ID, 2, address(f.meme)), 100);
            assertEq(f.vault.totalLiability(asset), 30);
            assertEq(f.vault.totalLiability(address(f.meme)), raw ? 100 : 200);
            if (role == 1) assertEq(f.gauge.positionOf(ALICE).memeClaimable, raw ? 0 : 100);
            assertEq(f.meme.allowance(address(f.vault), address(f.hook)), 0);
            // Consume any retained Meme; guards and ledgers must have been restored.
            vm.prank(ALICE);
            f.vault.claimUserRewards(ID, role, role == 0 ? uint32(1) : uint32(0), false, false, 0);
            assertEq(f.meme.balanceOf(ALICE), 100);
            assertEq(nativeQuote ? ALICE.balance : f.quote.balanceOf(ALICE), 30);
            assertTrue(vm.revertToState(snapshot));
        }
    }

    function test_realHolderGasExhaustionMatrix() public {
        for (uint256 i; i < 8; ++i) {
            _holderCase(i);
        }
    }

    function _holderCase(uint256 i) private {
        uint256 snapshot = vm.snapshotState();
        HolderFixture memory f;
        bool nativeQuote = i & 1 != 0;
        bool raw = i & 2 != 0;
        f.registry = new HolderFeeRegistryMock(address(this));
        f.rewards = new HolderRewardsDistributorV1(address(f.registry));
        f.creators = new HolderFeeCreatorMock();
        f.creators.setEpoch(ID, 1, address(this));
        f.vault =
            new HolderFeeVaultHarness(address(f.registry), address(f.creators), address(this), keccak256("policy"));
        f.quote = new MockExactQuoteToken(18);
        f.meme = new TickerMemeTokenV1(ID, address(this), address(this), address(f.rewards), "Gas", "G", "", 1000 ether);
        f.hook = new CompletionGasHook(address(f.vault));
        address asset = nativeQuote ? address(0) : address(f.quote);
        MarketView memory value;
        value.config.memeToken = address(f.meme);
        value.config.quoteAsset = asset;
        value.config.curve = address(this);
        value.config.graduatedHook = address(f.hook);
        value.config.creatorFeesToHolders = true;
        value.runtime.launchPhase = 1;
        value.runtime.sourceVersion = 1;
        f.registry.setMarket(ID, value);
        f.rewards.registerFeeSharingMarket(ID, address(f.vault), address(0x456));
        f.meme.transfer(ALICE, 100 ether);
        if (nativeQuote) vm.deal(address(f.vault), 30 ether);
        else f.quote.mint(address(f.vault), 30 ether);
        f.vault.seedHolder(ID, 1, asset, 30 ether);
        f.vault.fundHolderRewards(ID, 1);
        f.meme.transfer(address(f.vault), 100 ether);
        f.vault.seedHolder(ID, 1, address(f.meme), 100 ether);
        f.vault.fundHolderMemeRewards(ID);
        vm.warp(block.timestamp + 24 hours);
        (uint256 expectedQ, uint256 expectedM) = f.rewards.claimableAssets(ID, ALICE);
        assertGt(expectedQ, 0);
        assertGt(expectedM, 0);
        if (i & 4 != 0) {
            vm.cool(address(f.vault));
            vm.cool(address(f.registry));
            vm.cool(address(f.rewards));
            vm.cool(address(f.meme));
            vm.cool(address(f.quote));
            vm.cool(address(f.hook));
        }
        vm.expectCall(
            address(f.hook),
            abi.encodeWithSignature("convertRewards(bytes32,uint256,uint256)", ID, expectedM, block.timestamp + 240)
        );
        vm.prank(ALICE);
        (bool ok, bytes memory result) = address(f.vault).call{gas: 1_500_000}(
            abi.encodeCall(f.vault.claimUserRewards, (ID, uint8(2), uint32(0), true, raw, block.timestamp + 240))
        );
        assertTrue(ok, "real holder completion survives exhausting conversion");
        _assertResult(result, expectedQ, expectedM, raw);
        assertEq(nativeQuote ? ALICE.balance : f.quote.balanceOf(ALICE), expectedQ);
        assertEq(f.meme.balanceOf(ALICE), 100 ether + (raw ? expectedM : 0));
        (uint256 remainingQ, uint256 remainingM) = f.rewards.claimableAssets(ID, ALICE);
        assertEq(remainingQ, 0);
        assertEq(remainingM, raw ? 0 : expectedM);
        assertEq(f.meme.allowance(address(f.vault), address(f.hook)), 0);
        assertEq(f.meme.allowance(address(f.vault), address(f.rewards)), 0);
        vm.prank(ALICE);
        f.vault.claimUserRewards(ID, 2, 0, false, false, 0);
        assertEq(f.meme.balanceOf(ALICE), 100 ether + expectedM);
        assertEq(nativeQuote ? ALICE.balance : f.quote.balanceOf(ALICE), expectedQ);
        assertTrue(vm.revertToState(snapshot));
    }

    function _assertResult(bytes memory data, uint256 q, uint256 m, bool raw) private pure {
        (uint256 paid, uint256 memePaid, uint256 retained) = abi.decode(data, (uint256, uint256, uint256));
        assertEq(paid, q);
        assertEq(memePaid, raw ? m : 0);
        assertEq(retained, raw ? 0 : m);
    }
}
