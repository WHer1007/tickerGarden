// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;
import {Test} from "forge-std/Test.sol";
import {PoolManager} from "@uniswap/v4-core/src/PoolManager.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey as V4Key} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {ModifyLiquidityParams, SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {PoolSwapTest} from "@uniswap/v4-core/src/test/PoolSwapTest.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {PoolId} from "@uniswap/v4-core/src/types/PoolId.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {PoolModifyLiquidityTest} from "@uniswap/v4-core/src/test/PoolModifyLiquidityTest.sol";
import {TickerGardenMemeHook} from "../../../src/v1/modules/TickerGardenMemeHook.sol";
import {TickerGardenRewardConversion} from "../../../src/v1/shared/TickerGardenRewardConversion.sol";
import {MarketView, PoolKey} from "../../../src/v1/interfaces/IV1Protocol.sol";
import {MockExactQuoteToken} from "../mocks/MockV1QuoteAssets.sol";

contract ConversionPoolRegistry {
    address public graduationExecutor = address(0xD1);
    MarketView private value;
    PoolKey private key;

    function configure(address meme, address quote, address hook) external {
        value.config.memeToken = meme;
        value.config.quoteAsset = quote;
        value.config.graduatedHook = hook;
        value.runtime.sourceVersion = 1;
        key = PoolKey(meme < quote ? meme : quote, meme < quote ? quote : meme, 0, 60, hook);
    }

    function market(bytes32) external view returns (MarketView memory) {
        return value;
    }

    function canonicalPoolKey(bytes32) external view returns (PoolKey memory) {
        return key;
    }

    function activate() external {
        value.runtime.launchPhase = 1;
        value.runtime.sourceVersion = 2;
        value.runtime.poolId = keccak256(abi.encode(key));
    }
}

contract RewardConversionPoolTest is Test {
    bytes32 constant MARKET = keccak256("conversion");
    address constant HOOK = address(0x102044);
    ConversionPoolRegistry registry;
    PoolManager manager;
    TickerGardenMemeHook hook;
    MockExactQuoteToken meme;
    MockExactQuoteToken quote;
    bool nativeQuote;
    uint256 activatedAt;
    receive() external payable {}

    function _setup(bool native_, bool memeFirst) private {
        nativeQuote = native_;
        registry = new ConversionPoolRegistry();
        manager = new PoolManager(address(this));
        MockExactQuoteToken a = new MockExactQuoteToken(18);
        MockExactQuoteToken b = new MockExactQuoteToken(18);
        meme = (address(a) < address(b)) == memeFirst ? a : b;
        quote = meme == a ? b : a;
        deployCodeTo(
            "TickerGardenMemeHook.sol:TickerGardenMemeHook",
            abi.encode(address(registry), address(manager), address(this), address(0xD1)),
            HOOK
        );
        hook = TickerGardenMemeHook(payable(HOOK));
        registry.configure(address(meme), native_ ? address(0) : address(quote), HOOK);
        PoolKey memory key = registry.canonicalPoolKey(MARKET);
        vm.prank(address(0xD1));
        hook.registerExpectedPool(MARKET, key, 2);
        V4Key memory v4key = V4Key(Currency.wrap(key.currency0), Currency.wrap(key.currency1), 0, 60, IHooks(HOOK));
        manager.initialize(v4key, uint160(1 << 96));
        vm.prank(address(0xD1));
        hook.activatePool(keccak256(abi.encode(key)));
        registry.activate();
        activatedAt = block.timestamp;
        PoolModifyLiquidityTest lp = new PoolModifyLiquidityTest(IPoolManager(address(manager)));
        meme.mint(address(this), 100 ether);
        quote.mint(address(this), 100 ether);
        meme.approve(address(lp), type(uint256).max);
        quote.approve(address(lp), type(uint256).max);
        vm.deal(address(this), 100 ether);
        lp.modifyLiquidity{value: native_ ? 1 ether : 0}(
            v4key, ModifyLiquidityParams(-600, 600, 1 ether, bytes32(0)), ""
        );
        meme.approve(HOOK, type(uint256).max);
        vm.warp(block.timestamp + 40 minutes);
    }

    function _full(bool native_, bool memeFirst) private {
        _setup(native_, memeFirst);
        uint256 beforeMeme = meme.balanceOf(address(this));
        uint256 beforeQuote = native_ ? address(this).balance : quote.balanceOf(address(this));
        (uint256 spent, uint256 received) = hook.convertRewards(MARKET, 0.001 ether, block.timestamp + 60);
        assertEq(spent, 0.001 ether);
        assertGt(received, 0);
        assertEq(beforeMeme - meme.balanceOf(address(this)), spent);
        assertEq((native_ ? address(this).balance : quote.balanceOf(address(this))) - beforeQuote, received);
        assertEq(meme.balanceOf(HOOK), 0);
        // A recursive afterSwap fee would call the fee-credit interface on this test and revert.
        assertEq(hook.poolBinding(keccak256(abi.encode(registry.canonicalPoolKey(MARKET)))).feeNonce, 0);
    }

    function test_realPoolMemeCurrency0NoRecursiveFee() public {
        _full(false, true);
    }

    function test_realPoolMemeCurrency1NoRecursiveFee() public {
        _full(false, false);
    }

    function test_realPoolNativeQuote() public {
        _full(true, false);
    }

    function _protocolFeeConversion(bool native_, bool memeFirst) private {
        _setup(native_, memeFirst);
        PoolKey memory k = registry.canonicalPoolKey(MARKET);
        manager.setProtocolFeeController(address(this));
        manager.setProtocolFee(
            V4Key(Currency.wrap(k.currency0), Currency.wrap(k.currency1), 0, 60, IHooks(HOOK)), 1000 | (500 << 12)
        );
        uint256 beforeMeme = meme.balanceOf(address(this));
        uint256 beforeQuote = native_ ? address(this).balance : quote.balanceOf(address(this));
        (uint256 spent, uint256 received) = hook.convertRewards(MARKET, 0.001 ether, block.timestamp + 60);
        assertEq(spent, 0.001 ether);
        assertEq(beforeMeme - meme.balanceOf(address(this)), spent);
        assertEq((native_ ? address(this).balance : quote.balanceOf(address(this))) - beforeQuote, received);
        assertGe(received, spent * 98 / 100);
        uint256 rate = k.currency0 == address(meme) ? 1000 : 500;
        assertApproxEqAbs(manager.protocolFeesAccrued(Currency.wrap(address(meme))), spent * rate / 1_000_000, 1);
        assertEq(hook.poolBinding(_pool()).feeNonce, 0);
        assertEq(meme.balanceOf(HOOK), 0);
    }

    function test_protocolFeeConversionMemeFirst() public {
        _protocolFeeConversion(false, true);
    }

    function test_protocolFeeConversionMemeSecond() public {
        _protocolFeeConversion(false, false);
    }

    function test_protocolFeeConversionNativeQuote() public {
        _protocolFeeConversion(true, false);
    }

    function test_partialFillRefundWithoutPriceFloor() public {
        _setup(false, true);
        uint256 beforeMeme = meme.balanceOf(address(this));
        (uint256 spent, uint256 received) = hook.convertRewards(MARKET, 1 ether, block.timestamp + 60);
        assertGt(spent, 0);
        assertLt(spent, 1 ether);
        assertGt(received, 0);
        assertEq(beforeMeme - meme.balanceOf(address(this)), spent);
    }

    function test_onlyVaultAndBoundCallback() public {
        _setup(false, true);
        vm.prank(address(0xBAD));
        vm.expectRevert();
        hook.convertRewards(MARKET, 1 ether, block.timestamp + 60);
        vm.prank(address(manager));
        vm.expectRevert();
        hook.unlockCallback("");
        vm.expectRevert();
        hook.convertRewards(MARKET, 1 ether, block.timestamp - 1);
    }

    // Test fee receiver only: production exact-arrival and attribution are tested in FeeVault suites.
    function beginV4Credit(bytes32, address, uint256, uint32, bytes32) external {
        require(msg.sender == HOOK);
    }

    function finalizeV4Credit(bytes32, address, uint256, uint256, uint256, uint256, uint64, bytes32) external {
        require(msg.sender == HOOK);
    }

    function _swap(uint256 amount, bool zeroForOne) private {
        PoolSwapTest router = new PoolSwapTest(IPoolManager(address(manager)));
        meme.approve(address(router), type(uint256).max);
        quote.approve(address(router), type(uint256).max);
        PoolKey memory k = registry.canonicalPoolKey(MARKET);
        router.swap(
            V4Key(Currency.wrap(k.currency0), Currency.wrap(k.currency1), 0, 60, IHooks(HOOK)),
            SwapParams(
                zeroForOne, -int256(amount), zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1
            ),
            PoolSwapTest.TestSettings(false, false),
            ""
        );
    }

    function _pool() private view returns (bytes32) {
        return keccak256(abi.encode(registry.canonicalPoolKey(MARKET)));
    }

    function test_conversionDoesNotWaitForReferenceWindow() public {
        _setup(false, true);
        vm.warp(activatedAt + 1);
        (uint256 spent, uint256 received) = hook.convertRewards(MARKET, 0.001 ether, block.timestamp + 60);
        assertEq(spent, 0.001 ether);
        assertGt(received, 0);
    }

    function test_adverseSpotDoesNotBlockConversion() public {
        _setup(false, true);
        _swap(0.02 ether, true);
        (, int24 spot,,) = StateLibrary.getSlot0(IPoolManager(address(manager)), PoolId.wrap(_pool()));
        assertLt(spot, -200);
        (uint256 spent, uint256 received) = hook.convertRewards(MARKET, 0.001 ether, block.timestamp + 60);
        assertEq(spent, 0.001 ether);
        assertGt(received, 0);
    }

    function test_highImpactPartialFillRefundBothTokenOrders() public {
        for (uint256 order; order < 2; ++order) {
            _setup(false, order == 0);
            uint256 before = meme.balanceOf(address(this));
            (uint256 spent, uint256 received) = hook.convertRewards(MARKET, 1 ether, block.timestamp + 60);
            assertGt(spent, 0);
            assertLt(spent, 1 ether);
            assertGt(received, 0);
            assertLt(received, spent * 98 / 100); // Accepted despite exceeding the old reference discount.
            assertEq(meme.balanceOf(address(this)), before - spent);
            assertEq(meme.balanceOf(HOOK), 0);
        }
    }

    function test_conversionWorksImmediatelyAndAfterLongIdle() public {
        _setup(false, true);
        _swap(0.002 ether, true);
        (uint256 spent, uint256 received) = hook.convertRewards(MARKET, 0.001 ether, block.timestamp + 60);
        assertGt(spent, 0);
        assertGt(received, 0);
        vm.warp(block.timestamp + 365 days);
        (spent, received) = hook.convertRewards(MARKET, 0.001 ether, block.timestamp + 60);
        assertGt(spent, 0);
        assertGt(received, 0);
    }

    function test_zeroFeeSwapStillMovesPoolPrice() public {
        _setup(false, true);
        _swap(50, true);
        assertEq(hook.poolBinding(_pool()).feeNonce, 0);
        (, int24 spot,,) = StateLibrary.getSlot0(IPoolManager(address(manager)), PoolId.wrap(_pool()));
        assertLt(spot, 0);
    }
}
