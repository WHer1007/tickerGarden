// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {FullMath} from "@uniswap/v4-core/src/libraries/FullMath.sol";
import {Pool} from "@uniswap/v4-core/src/libraries/Pool.sol";
import {SqrtPriceMath} from "@uniswap/v4-core/src/libraries/SqrtPriceMath.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {LiquidityAmounts} from "@uniswap/v4-periphery/src/libraries/LiquidityAmounts.sol";

import {PoolKey} from "../interfaces/IV1Protocol.sol";

/// @notice Canonical price, full-range tick, and liquidity derivation for a swept V1 launch.
library GraduationPoolMath {
    uint160 internal constant HOOK_PERMISSION_MASK = 0x2044;
    uint160 private constant ALL_HOOK_PERMISSION_BITS = (1 << 14) - 1;
    uint256 private constant Q128 = 1 << 128;
    uint256 private constant Q192 = 1 << 192;

    struct PoolPlan {
        bytes32 poolId;
        uint256 amount0;
        uint256 amount1;
        uint160 sqrtPriceX96;
        int24 initialTick;
        int24 tickLower;
        int24 tickUpper;
        uint128 liquidity;
        uint256 mintAmount0;
        uint256 mintAmount1;
    }

    error InvalidGraduationPoolKey();
    error InvalidGraduationPoolAmounts(uint256 amount0, uint256 amount1);
    error InvalidGraduationSqrtPrice(uint256 sqrtPriceX96);
    error InvalidGraduationLiquidity(uint256 liquidity, uint256 maximum);

    function derive(
        PoolKey memory key,
        address quoteAsset,
        address memeToken,
        uint256 sweptQuote,
        uint256 poolMemeAmount
    ) internal pure returns (PoolPlan memory plan) {
        _validateKey(key, quoteAsset, memeToken);
        (plan.amount0, plan.amount1) =
            quoteAsset == key.currency0 ? (sweptQuote, poolMemeAmount) : (poolMemeAmount, sweptQuote);
        if (
            plan.amount0 == 0 || plan.amount1 == 0 || plan.amount0 > uint256(uint128(type(int128).max))
                || plan.amount1 > uint256(uint128(type(int128).max))
        ) revert InvalidGraduationPoolAmounts(plan.amount0, plan.amount1);

        plan.sqrtPriceX96 = _sqrtPriceX96(plan.amount0, plan.amount1);
        if (plan.sqrtPriceX96 <= TickMath.MIN_SQRT_PRICE || plan.sqrtPriceX96 >= TickMath.MAX_SQRT_PRICE) {
            revert InvalidGraduationSqrtPrice(plan.sqrtPriceX96);
        }
        plan.initialTick = TickMath.getTickAtSqrtPrice(plan.sqrtPriceX96);
        plan.tickLower = (TickMath.MIN_TICK / key.tickSpacing) * key.tickSpacing;
        plan.tickUpper = (TickMath.MAX_TICK / key.tickSpacing) * key.tickSpacing;

        plan.liquidity = LiquidityAmounts.getLiquidityForAmounts(
            plan.sqrtPriceX96,
            TickMath.getSqrtPriceAtTick(plan.tickLower),
            TickMath.getSqrtPriceAtTick(plan.tickUpper),
            plan.amount0,
            plan.amount1
        );
        uint128 maximumLiquidity = Pool.tickSpacingToMaxLiquidityPerTick(key.tickSpacing);
        if (plan.liquidity == 0 || plan.liquidity > maximumLiquidity) {
            revert InvalidGraduationLiquidity(plan.liquidity, maximumLiquidity);
        }
        plan.mintAmount0 = SqrtPriceMath.getAmount0Delta(
            plan.sqrtPriceX96, TickMath.getSqrtPriceAtTick(plan.tickUpper), plan.liquidity, true
        );
        plan.mintAmount1 = SqrtPriceMath.getAmount1Delta(
            TickMath.getSqrtPriceAtTick(plan.tickLower), plan.sqrtPriceX96, plan.liquidity, true
        );
        if (
            plan.mintAmount0 == 0 || plan.mintAmount1 == 0 || plan.mintAmount0 > plan.amount0
                || plan.mintAmount1 > plan.amount1
        ) revert InvalidGraduationLiquidity(plan.liquidity, maximumLiquidity);
        plan.poolId = keccak256(abi.encode(key));
    }

    function _sqrtPriceX96(uint256 amount0, uint256 amount1) private pure returns (uint160 result) {
        uint256 raw;
        // With both amounts constrained to int128.max, this comparison exactly identifies whether the Q192
        // FullMath quotient fits uint256. The Q128 fallback then remains representable for the entire domain.
        if (amount1 <= (amount0 << 64)) {
            raw = Math.sqrt(FullMath.mulDiv(amount1, Q192, amount0));
        } else {
            raw = Math.sqrt(FullMath.mulDiv(amount1, Q128, amount0)) << 32;
        }
        if (raw > type(uint160).max) revert InvalidGraduationSqrtPrice(raw);
        result = uint160(raw);
    }

    function _validateKey(PoolKey memory key, address quoteAsset, address memeToken) private pure {
        address expected0 = quoteAsset < memeToken ? quoteAsset : memeToken;
        address expected1 = quoteAsset < memeToken ? memeToken : quoteAsset;
        if (
            memeToken == address(0) || quoteAsset == memeToken || key.currency0 != expected0
                || key.currency1 != expected1 || key.currency0 >= key.currency1 || key.fee != 0 || key.tickSpacing < 1
                || key.tickSpacing > type(int16).max || key.hooks == address(0)
                || (uint160(key.hooks) & ALL_HOOK_PERMISSION_BITS) != HOOK_PERMISSION_MASK
        ) revert InvalidGraduationPoolKey();
    }
}
