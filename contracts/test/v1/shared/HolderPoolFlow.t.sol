// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;
import {Vm} from "forge-std/Vm.sol";
import {BalanceDelta, BalanceDeltaLibrary} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {Test} from "forge-std/Test.sol";
import {PoolManager} from "@uniswap/v4-core/src/PoolManager.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey as V4Key} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {ModifyLiquidityParams, SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {PoolModifyLiquidityTest} from "@uniswap/v4-core/src/test/PoolModifyLiquidityTest.sol";
import {PoolSwapTest} from "@uniswap/v4-core/src/test/PoolSwapTest.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {TickerGardenMemeHook} from "../../../src/v1/modules/TickerGardenMemeHook.sol";
import {ProtocolFeeVault, ProtocolFeeVaultInit} from "../../../src/v1/modules/ProtocolFeeVault.sol";
import {HolderAccountingHarness as HolderRewardsDistributorV1} from "../mocks/HolderAccountingHarness.sol";
import {TickerMemeTokenV1} from "../../../src/v1/modules/TickerMemeTokenV1.sol";
import {MarketView, PoolKey} from "../../../src/v1/interfaces/IV1Protocol.sol";
import {MockExactQuoteToken} from "../mocks/MockV1QuoteAssets.sol";
import {HolderFeeCreatorMock} from "./HolderFeeSharing.t.sol";

contract HolderPoolRegistry {
    address public factory = msg.sender;
    address public graduationExecutor = msg.sender;
    MarketView v;
    PoolKey k;

    function set(MarketView memory value, PoolKey memory key) external {
        v = value;
        k = key;
    }

    function market(bytes32) external view returns (MarketView memory) {
        return v;
    }

    function canonicalPoolKey(bytes32) external view returns (PoolKey memory) {
        return k;
    }
}

/// Local real Token -> PoolManager -> Hook -> FeeVault -> Distributor flow. Only configuration is mocked.
contract HolderPoolFlowTest is Test {
    bytes32 constant ID = keccak256("holder pool flow");
    address constant HOOK = address(0x102044);
    address constant ALICE = address(0xA11CE);
    HolderRewardsDistributorV1 d;
    TickerMemeTokenV1 meme;
    MockExactQuoteToken quote;
    ProtocolFeeVault vault;
    PoolSwapTest router;
    PoolManager manager;
    HolderPoolRegistry registry;
    V4Key key;

    function setUp() public {
        vm.warp(1_800_000_000);
        registry = new HolderPoolRegistry();
        manager = new PoolManager(address(this));
        HolderFeeCreatorMock creators = new HolderFeeCreatorMock();
        creators.setEpoch(ID, 1, address(this));
        vault = new ProtocolFeeVault(
            ProtocolFeeVaultInit(
                address(registry),
                address(registry),
                address(manager),
                address(creators),
                address(this),
                keccak256("policy")
            )
        );
        deployCodeTo(
            "TickerGardenMemeHook.sol:TickerGardenMemeHook",
            abi.encode(address(registry), address(manager), address(vault), address(this)),
            HOOK
        );
        d = new HolderRewardsDistributorV1(address(registry));
        meme = new TickerMemeTokenV1(ID, address(this), address(this), address(d), "Flow", "FLOW", "", 1000 ether);
        quote = new MockExactQuoteToken(18);
        quote.mint(address(this), 100 ether);
        MarketView memory v;
        v.config.memeToken = address(meme);
        v.config.quoteAsset = address(quote);
        v.config.curve = address(this);
        v.config.graduatedHook = HOOK;
        v.config.creatorFeesToHolders = true;
        v.config.feePolicyId = keccak256("policy");
        v.config.executionSpecId = keccak256("V1-EXEC-11");
        v.runtime.sourceVersion = 1;
        PoolKey memory k = PoolKey(
            address(meme) < address(quote) ? address(meme) : address(quote),
            address(meme) < address(quote) ? address(quote) : address(meme),
            0,
            60,
            HOOK
        );
        registry.set(v, k);
        d.registerFeeSharingMarket(ID, address(vault), address(0xC002));
        TickerGardenMemeHook hook = TickerGardenMemeHook(payable(HOOK));
        hook.registerExpectedPool(ID, k, 2);
        key = V4Key(Currency.wrap(k.currency0), Currency.wrap(k.currency1), 0, 60, IHooks(HOOK));
        manager.initialize(key, uint160(1 << 96));
        hook.activatePool(keccak256(abi.encode(k)));
        v.runtime.sourceVersion = 2;
        v.runtime.launchPhase = 1;
        v.runtime.poolId = keccak256(abi.encode(k));
        registry.set(v, k);
        PoolModifyLiquidityTest lp = new PoolModifyLiquidityTest(IPoolManager(address(manager)));
        meme.approve(address(lp), type(uint256).max);
        quote.approve(address(lp), type(uint256).max);
        lp.modifyLiquidity(key, ModifyLiquidityParams(-600, 600, 1 ether, bytes32(0)), "");
        router = new PoolSwapTest(IPoolManager(address(manager)));
        meme.transfer(ALICE, 100 ether);
        vm.prank(ALICE);
        meme.approve(address(router), type(uint256).max);
    }

    function _sell() internal returns (uint256 used) {
        bool direction = Currency.unwrap(key.currency0) == address(meme);
        uint256 gasBefore = gasleft();
        vm.prank(ALICE);
        router.swap(
            key,
            SwapParams(
                direction, -int256(0.0001 ether), direction ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1
            ),
            PoolSwapTest.TestSettings(false, false),
            ""
        );
        used = gasBefore - gasleft();
    }

    function test_swapReusesSlot0AndFinalizedMarketSnapshot() public {
        bytes32 poolId = keccak256(abi.encode(key));
        bytes32 slot = keccak256(abi.encode(poolId, uint256(6)));
        vm.expectCall(address(manager), abi.encodeWithSignature("extsload(bytes32)", slot), uint64(1));
        // Hook binding + FeeVault begin + FeeVault finalize. Attribution reuses finalize's view.
        vm.expectCall(address(registry), abi.encodeWithSignature("market(bytes32)", ID), uint64(3));
        _sell();
        assertGt(vault.holderLiability(ID, 1, address(quote)), 0);
        assertEq(quote.balanceOf(address(vault)), vault.totalLiability(address(quote)));
    }

    function _protocolFeeTrade(bool sell, bool exactInput) private {
        manager.setProtocolFeeController(address(this));
        manager.setProtocolFee(key, 1000 | (500 << 12));
        quote.mint(ALICE, 10 ether);
        vm.prank(ALICE);
        quote.approve(address(router), type(uint256).max);
        bool zeroForOne = sell == (Currency.unwrap(key.currency0) == address(meme));
        MockExactQuoteToken input =
            MockExactQuoteToken(zeroForOne ? Currency.unwrap(key.currency0) : Currency.unwrap(key.currency1));
        MockExactQuoteToken output =
            MockExactQuoteToken(zeroForOne ? Currency.unwrap(key.currency1) : Currency.unwrap(key.currency0));
        uint256 inputBefore = input.balanceOf(ALICE);
        uint256 outputBefore = output.balanceOf(ALICE);
        vm.recordLogs();
        vm.prank(ALICE);
        uint256 gasBefore = gasleft();
        BalanceDelta delta = router.swap(
            key,
            SwapParams(
                zeroForOne,
                exactInput ? -int256(0.0001 ether) : int256(0.0001 ether),
                zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1
            ),
            PoolSwapTest.TestSettings(false, false),
            ""
        );
        emit log_named_uint("router swap gas", gasBefore - gasleft());
        uint256 spent =
            uint256(-int256(zeroForOne ? BalanceDeltaLibrary.amount0(delta) : BalanceDeltaLibrary.amount1(delta)));
        uint256 received =
            uint256(int256(zeroForOne ? BalanceDeltaLibrary.amount1(delta) : BalanceDeltaLibrary.amount0(delta)));
        assertEq(inputBefore - input.balanceOf(ALICE), spent);
        assertEq(output.balanceOf(ALICE) - outputBefore, received);
        _assertProtocolFeeLogs(exactInput, zeroForOne, spent, received);
    }

    struct FeeRecord {
        uint64 nonce;
        bytes32 feeId;
        uint256 base;
        uint256 fee;
        uint256 lp;
        uint256 credited;
    }

    function _assertProtocolFeeLogs(bool exactInput, bool zeroForOne, uint256 spent, uint256 received) private {
        address input = zeroForOne ? Currency.unwrap(key.currency0) : Currency.unwrap(key.currency1);
        address output = zeroForOne ? Currency.unwrap(key.currency1) : Currency.unwrap(key.currency0);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        bool found;
        for (uint256 i; i < logs.length; ++i) {
            if (
                logs[i].emitter != HOOK
                    || logs[i].topics[0]
                        != keccak256(
                            "V4FeeAccrued(bytes32,bytes32,address,uint64,bytes32,uint256,uint256,uint256,uint256)"
                        )
            ) continue;
            FeeRecord memory f = abi.decode(logs[i].data, (FeeRecord));
            assertEq(f.fee, f.base / 100);
            assertEq(f.lp, 0);
            assertEq(f.credited, f.fee);
            address feeAsset = address(uint160(uint256(logs[i].topics[3])));
            assertEq(feeAsset, exactInput ? output : input);
            assertEq(MockExactQuoteToken(feeAsset).balanceOf(address(vault)), f.fee);
            assertEq(vault.totalLiability(feeAsset), f.fee);
            uint256 coreInput = exactInput ? spent : spent - f.fee;
            assertApproxEqAbs(
                manager.protocolFeesAccrued(Currency.wrap(input)), coreInput * (zeroForOne ? 1000 : 500) / 1_000_000, 1
            );
            assertEq(f.base, exactInput ? received + f.fee : spent - f.fee);
            found = true;
        }
        assertTrue(found);
    }

    function test_extraProtocolFeeBuyExactInput() public {
        _protocolFeeTrade(false, true);
    }

    function test_extraProtocolFeeSellExactInput() public {
        _protocolFeeTrade(true, true);
    }

    function test_extraProtocolFeeBuyExactOutput() public {
        _protocolFeeTrade(false, false);
    }

    function test_extraProtocolFeeSellExactOutput() public {
        _protocolFeeTrade(true, false);
    }

    function test_extraProtocolFeeWithCreatorTaxAndHolderSharing() public {
        // Rebind only the mocked registry view; the deployed hook and vault remain unchanged.
        MarketView memory value = registry.market(ID);
        value.config.creatorTaxBps = 250;
        registry.set(value, registry.canonicalPoolKey(ID));
        manager.setProtocolFeeController(address(this));
        manager.setProtocolFee(key, 1000 | (500 << 12));
        quote.mint(ALICE, 10 ether);
        vm.prank(ALICE);
        quote.approve(address(router), type(uint256).max);
        bool zeroForOne = Currency.unwrap(key.currency0) == address(quote);
        vm.recordLogs();
        vm.prank(ALICE);
        BalanceDelta delta = router.swap(
            key,
            SwapParams(
                zeroForOne,
                -int256(0.0001 ether),
                zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1
            ),
            PoolSwapTest.TestSettings(false, false),
            ""
        );
        uint256 spent =
            uint256(-int256(zeroForOne ? BalanceDeltaLibrary.amount0(delta) : BalanceDeltaLibrary.amount1(delta)));
        _assertTaxedLogs(spent, zeroForOne);
    }

    function _assertTaxedLogs(uint256 spent, bool zeroForOne) private {
        Vm.Log[] memory logs = vm.getRecordedLogs();
        uint256 base;
        uint256 total;
        uint256 creator;
        uint256 staker;
        uint256 platform;
        uint256 holder;
        address asset;
        for (uint256 i; i < logs.length; ++i) {
            if (
                logs[i].emitter == HOOK
                    && logs[i].topics[0]
                        == keccak256(
                            "V4FeeAccrued(bytes32,bytes32,address,uint64,bytes32,uint256,uint256,uint256,uint256)"
                        )
            ) {
                FeeRecord memory f = abi.decode(logs[i].data, (FeeRecord));
                base = f.base;
                total = f.fee;
                asset = address(uint160(uint256(logs[i].topics[3])));
            }
            if (
                logs[i].emitter == address(vault)
                    && logs[i].topics[0]
                        == keccak256(
                            "FeeBucketsCredited(bytes32,uint32,address,bytes32,uint256,uint256,uint256,uint256)"
                        )
            ) (, creator, staker, platform,) = abi.decode(logs[i].data, (bytes32, uint256, uint256, uint256, uint256));
            if (
                logs[i].emitter == address(vault)
                    && logs[i].topics[0] == keccak256("HolderFeesAccrued(bytes32,uint32,address,uint256)")
            ) holder = abi.decode(logs[i].data, (uint256));
        }
        uint256 tax = base * 250 / 10_000;
        uint256 baseFee = base / 100;
        uint256 creatorBase = baseFee - platform;
        assertEq(total, baseFee + tax);
        assertEq(platform, baseFee * 3000 / 10_000);
        assertEq(staker, 0);
        assertEq(holder, creatorBase / 2);
        assertEq(creator, creatorBase - holder + tax);
        assertGt(spent, 0);
        assertGt(
            manager.protocolFeesAccrued(Currency.wrap(Currency.unwrap(zeroForOne ? key.currency0 : key.currency1))), 0
        );
        assertEq(asset, address(meme));
        assertGt(total, 0);
        assertEq(creator + staker + platform + holder, total);
        assertEq(vault.creatorLiability(ID, 1, asset), creator);
        assertEq(vault.holderLiability(ID, 1, asset), holder);
        assertEq(meme.balanceOf(address(vault)), total);
        assertEq(quote.balanceOf(address(vault)), 0);
        assertEq(MockExactQuoteToken(asset).balanceOf(address(vault)), vault.totalLiability(asset));
    }

    function test_realPoolSwapFundsSixBatchesAndExpiresWithoutBlockingTrading() public {
        uint256 funded;
        for (uint256 i; i < 6; ++i) {
            _sell();
            funded += vault.fundHolderRewards(ID, 1);
            vm.warp(block.timestamp + 4 hours);
        }
        assertEq(d.marketState(ID).count, 6);
        assertEq(d.totalLiability(address(quote)), funded);
        vm.warp(block.timestamp + 24 hours);
        uint256 snapshot = vm.snapshotState();
        d.checkpoint(ID);
        uint256 baseline = _sell();
        vm.revertToState(snapshot);
        uint256 expired = _sell();
        emit log_named_uint("real router swap gas after checkpoint", baseline);
        emit log_named_uint("real router swap gas with six expired Holder batches", expired);
        assertLe(expired, 800_000);
        assertLe(expired, baseline + 300_000);
        assertEq(d.marketState(ID).count, 0);
        assertGt(vault.holderLiability(ID, 1, address(quote)), 0);
        vm.prank(ALICE);
        uint256 claimed = d.claim(ID);
        assertApproxEqAbs(claimed, funded, 1);
        assertEq(d.totalLiability(address(quote)), funded - claimed);
        assertEq(quote.balanceOf(address(vault)), vault.totalLiability(address(quote)));
    }

    function test_holderClaimsOwnMemeThroughRealPoolAndVault() public {
        _protocolFeeTrade(false, true);
        uint256 funded = vault.fundHolderMemeRewards(ID);
        assertGt(funded, 0);
        vm.warp(block.timestamp + 24 hours);
        (, uint256 earned) = d.claimableAssets(ID, ALICE);
        assertGt(earned, 0);
        uint256 before = meme.balanceOf(ALICE);
        vm.prank(ALICE);
        (uint256 paid, uint256 raw) = vault.claimUserRewards(ID, 2, 0);
        assertEq(paid, 0);
        assertEq(raw, earned);
        assertEq(meme.balanceOf(ALICE), before + raw);
        (, earned) = d.claimableAssets(ID, ALICE);
        assertEq(earned, 0);
    }

    function test_holderRawClaimImmediatelyAfterRelease() public {
        _protocolFeeTrade(false, true);
        vault.fundHolderMemeRewards(ID);
        vm.warp(block.timestamp + 1 hours);
        (, uint256 earned) = d.claimableAssets(ID, ALICE);
        assertGt(earned, 0);
        uint256 before = meme.balanceOf(ALICE);
        vm.prank(ALICE);
        (, uint256 paid) = vault.claimUserRewards(ID, 2, 0);
        assertEq(paid, earned);
        assertEq(meme.balanceOf(ALICE), before + paid);
        assertEq(d.marketState(ID).supply, d.memeMarketState(ID).supply);
    }
}
