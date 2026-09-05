// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;
import {Test} from "forge-std/Test.sol";
import {PoolManager} from "@uniswap/v4-core/src/PoolManager.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey as V4Key} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {ModifyLiquidityParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
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
    }

    function _full(bool native_, bool memeFirst) private {
        _setup(native_, memeFirst);
        uint256 beforeMeme = meme.balanceOf(address(this));
        uint256 beforeQuote = native_ ? address(this).balance : quote.balanceOf(address(this));
        (uint256 spent, uint256 received) = hook.convertRewards(MARKET, 0.001 ether, 1, block.timestamp + 60);
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

    function test_partialFillRefundAndMinimumRollback() public {
        _setup(false, true);
        uint256 beforeMeme = meme.balanceOf(address(this));
        vm.expectRevert();
        hook.convertRewards(MARKET, 1 ether, 2 ether, block.timestamp + 60);
        assertEq(meme.balanceOf(address(this)), beforeMeme);
        (uint256 spent, uint256 received) = hook.convertRewards(MARKET, 1 ether, 1, block.timestamp + 60);
        assertGt(spent, 0);
        assertLt(spent, 1 ether);
        assertGt(received, 0);
        assertEq(beforeMeme - meme.balanceOf(address(this)), spent);
    }

    function test_onlyVaultAndBoundCallback() public {
        _setup(false, true);
        vm.prank(address(0xBAD));
        vm.expectRevert();
        hook.convertRewards(MARKET, 1 ether, 1, block.timestamp + 60);
        vm.prank(address(manager));
        vm.expectRevert();
        hook.unlockCallback("");
        vm.expectRevert();
        hook.convertRewards(MARKET, 1 ether, 1, block.timestamp - 1);
    }
}
