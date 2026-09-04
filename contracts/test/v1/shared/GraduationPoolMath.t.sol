// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";

import {PoolKey} from "../../../src/v1/interfaces/IV1Protocol.sol";
import {GraduationPoolMath} from "../../../src/v1/libraries/GraduationPoolMath.sol";

contract GraduationPoolMathHarness {
    function derive(
        PoolKey memory key,
        address quoteAsset,
        address memeToken,
        uint256 sweptQuote,
        uint256 poolMemeAmount
    ) external pure returns (GraduationPoolMath.PoolPlan memory) {
        return GraduationPoolMath.derive(key, quoteAsset, memeToken, sweptQuote, poolMemeAmount);
    }
}

contract GraduationPoolMathTest is Test {
    address private constant HOOK = address(0x2044);
    address private constant MEME = address(0x3000);
    address private constant QUOTE = address(0x2000);

    GraduationPoolMathHarness private harness;

    function setUp() public {
        harness = new GraduationPoolMathHarness();
    }

    function test_nativePinnedRuntimePoolPlanMatchesEveryIntegerOutput() public view {
        PoolKey memory key = _key(address(0), MEME, 200, HOOK);
        GraduationPoolMath.PoolPlan memory plan =
            harness.derive(key, address(0), MEME, 4_200_000_000_000_000_157, 204_081_632_653_061_226_669_443_287);

        assertEq(plan.poolId, keccak256(abi.encode(key)));
        assertEq(plan.amount0, 4_200_000_000_000_000_157);
        assertEq(plan.amount1, 204_081_632_653_061_226_669_443_287);
        assertEq(plan.sqrtPriceX96, 552_276_925_551_777_199_545_721_453_919_781);
        assertEq(plan.initialTick, 176_998);
        assertEq(plan.tickLower, -887_200);
        assertEq(plan.tickUpper, 887_200);
        assertEq(plan.liquidity, 29_277_002_188_455_996_084_176);
        assertLe(plan.mintAmount0, plan.amount0);
        assertLe(plan.mintAmount1, plan.amount1);
        assertGt(plan.mintAmount0, 0);
        assertGt(plan.mintAmount1, 0);
    }

    function test_erc20PinnedRuntimePoolPlanMatchesEveryIntegerOutput() public view {
        PoolKey memory key = _key(QUOTE, MEME, 200, HOOK);
        GraduationPoolMath.PoolPlan memory plan =
            harness.derive(key, QUOTE, MEME, 26_639_006_882_017_848_346, 204_081_632_653_061_224_642_468_854);

        assertEq(plan.amount0, 26_639_006_882_017_848_346);
        assertEq(plan.amount1, 204_081_632_653_061_224_642_468_854);
        assertEq(plan.sqrtPriceX96, 219_291_868_843_934_996_861_561_852_956_313);
        assertEq(plan.initialTick, 158_524);
        assertEq(plan.tickLower, -887_200);
        assertEq(plan.tickUpper, 887_200);
        assertEq(plan.liquidity, 73_732_842_185_408_371_800_139);
        assertLe(plan.mintAmount0, plan.amount0);
        assertLe(plan.mintAmount1, plan.amount1);
    }

    function test_memeAsCurrencyZeroMapsAmountsWithoutChangingTheirMeaning() public view {
        address highQuote = address(0x4000);
        PoolKey memory key = _key(MEME, highQuote, 60, HOOK);
        GraduationPoolMath.PoolPlan memory plan = harness.derive(key, highQuote, MEME, 4 ether, 2 ether);

        assertEq(plan.amount0, 2 ether);
        assertEq(plan.amount1, 4 ether);
        assertEq(plan.sqrtPriceX96, 112_045_541_949_572_279_837_463_876_454);
        assertEq(plan.tickLower, -887_220);
        assertEq(plan.tickUpper, 887_220);
    }

    function test_q128FallbackCoversARepresentableRatioThatQ192CannotHold() public view {
        PoolKey memory key = _key(QUOTE, MEME, 1, HOOK);
        GraduationPoolMath.PoolPlan memory plan = harness.derive(key, QUOTE, MEME, 1, uint256(1) << 100);

        assertEq(plan.sqrtPriceX96, uint256(1) << 146);
        assertEq(plan.initialTick, 693_181);
        assertGt(plan.liquidity, 0);
    }

    function test_q128FallbackAtQ192BoundaryRemainsValid() public view {
        PoolKey memory key = _key(QUOTE, MEME, 200, HOOK);
        uint256 amount0 = 1;
        uint256 amount1 = amount0 << 64;

        GraduationPoolMath.PoolPlan memory plan = harness.derive(key, QUOTE, MEME, amount0, amount1);

        // At the boundary the Q192 quotient is exactly 2^192. The Q128 branch
        // must be selected so the intermediate FullMath multiplication cannot
        // overflow uint256, while producing the same exact square-root price.
        assertEq(plan.amount0, amount0);
        assertEq(plan.amount1, amount1);
        assertEq(plan.sqrtPriceX96, uint160(1) << 128);
        assertGt(plan.sqrtPriceX96, TickMath.MIN_SQRT_PRICE);
        assertLt(plan.sqrtPriceX96, TickMath.MAX_SQRT_PRICE);
        assertGt(plan.liquidity, 0);
        assertGt(plan.mintAmount0, 0);
        assertGt(plan.mintAmount1, 0);
        assertLe(plan.mintAmount0, plan.amount0);
        assertLe(plan.mintAmount1, plan.amount1);
    }

    function test_zeroAndInt128OverflowAmountsFailClosed() public {
        PoolKey memory key = _key(QUOTE, MEME, 200, HOOK);
        vm.expectRevert(
            abi.encodeWithSelector(GraduationPoolMath.InvalidGraduationPoolAmounts.selector, uint256(0), uint256(1))
        );
        harness.derive(key, QUOTE, MEME, 0, 1);

        uint256 tooLarge = uint256(uint128(type(int128).max)) + 1;
        vm.expectRevert(
            abi.encodeWithSelector(GraduationPoolMath.InvalidGraduationPoolAmounts.selector, uint256(1), tooLarge)
        );
        harness.derive(key, QUOTE, MEME, 1, tooLarge);
    }

    function test_int128MaximumRatioRemainsInsideTheV4PriceDomain() public view {
        PoolKey memory key = _key(QUOTE, MEME, 200, HOOK);
        uint256 extreme = uint256(uint128(type(int128).max));
        GraduationPoolMath.PoolPlan memory plan = harness.derive(key, QUOTE, MEME, 1, extreme);

        assertGt(plan.sqrtPriceX96, 0);
        assertGt(plan.liquidity, 0);
    }

    function test_everyCanonicalPoolKeyFieldIsValidated() public {
        PoolKey memory key = _key(QUOTE, MEME, 200, HOOK);
        key.fee = 1;
        _expectInvalidKey(key, QUOTE, MEME);
        key = _key(QUOTE, MEME, 0, HOOK);
        _expectInvalidKey(key, QUOTE, MEME);
        key = _key(QUOTE, MEME, 32_768, HOOK);
        _expectInvalidKey(key, QUOTE, MEME);
        key = _key(QUOTE, MEME, 200, address(0x2045));
        _expectInvalidKey(key, QUOTE, MEME);
        key = _key(QUOTE, address(0x4000), 200, HOOK);
        _expectInvalidKey(key, QUOTE, MEME);
        key = _key(MEME, QUOTE, 200, HOOK);
        _expectInvalidKey(key, QUOTE, MEME);
    }

    function _expectInvalidKey(PoolKey memory key, address quote, address meme) private {
        vm.expectRevert(GraduationPoolMath.InvalidGraduationPoolKey.selector);
        harness.derive(key, quote, meme, 1 ether, 1 ether);
    }

    function _key(address currency0, address currency1, int24 spacing, address hook)
        private
        pure
        returns (PoolKey memory)
    {
        return PoolKey({currency0: currency0, currency1: currency1, fee: 0, tickSpacing: spacing, hooks: hook});
    }
}
