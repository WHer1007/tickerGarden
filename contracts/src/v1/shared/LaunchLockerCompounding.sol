// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IAllowanceTransfer} from "permit2/src/interfaces/IAllowanceTransfer.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {SqrtPriceMath} from "@uniswap/v4-core/src/libraries/SqrtPriceMath.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {PoolId} from "@uniswap/v4-core/src/types/PoolId.sol";
import {PoolKey as V4PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Actions} from "@uniswap/v4-periphery/src/libraries/Actions.sol";
import {LiquidityAmounts} from "@uniswap/v4-periphery/src/libraries/LiquidityAmounts.sol";
import {PositionInfo} from "@uniswap/v4-periphery/src/libraries/PositionInfoLibrary.sol";
import {PositionInfoLibrary} from "@uniswap/v4-periphery/src/libraries/PositionInfoLibrary.sol";

import {LaunchLockerCustody} from "./LaunchLockerCustody.sol";

interface ILaunchLockerPositionDependencies {
    function permit2() external view returns (IAllowanceTransfer);
}

/// @notice Permissionless exact-input compounding into one permanently locked canonical v4 position.
/// @dev Accrued fees are first materialized into this Locker. Only then are the Locker's canonical balances used to
///      derive an explicit liquidity amount; the deprecated delta-based PositionManager actions are never used.
abstract contract LaunchLockerCompounding is LaunchLockerCustody, ReentrancyGuard {
    using PositionInfoLibrary for PositionInfo;
    using SafeERC20 for IERC20;
    using StateLibrary for IPoolManager;

    IPoolManager internal immutable _lockerPoolManager;
    IAllowanceTransfer internal immutable _lockerPermit2;

    struct CompoundContext {
        bytes32 marketId;
        uint256 tokenId;
        bytes32 poolId;
        V4PoolKey key;
        PositionInfo info;
        uint128 liquidityBefore;
        address currency0;
        address currency1;
        uint256 balance0;
        uint256 balance1;
    }

    error InvalidLaunchLockerPositionDependencies(address poolManager, address permit2, address positionManager);
    error InvalidLockedPositionData(uint256 tokenId, bytes32 suppliedPoolId, bytes32 expectedPoolId);
    error LockedPositionLiquidityMismatch(uint256 tokenId, uint256 supplied, uint256 expected);
    error LockedCompoundBalanceMismatch(address currency, uint256 expected, uint256 actual);
    error LockedCompoundAmountOverflow(address currency, uint256 amount, uint256 maximum);

    event LockedFeesCompounded(
        bytes32 indexed marketId,
        uint256 amount0,
        uint256 amount1,
        uint128 liquidityAdded,
        uint256 remaining0,
        uint256 remaining1
    );

    constructor(bytes32 marketId_, address marketRegistry_, address positionManager_)
        LaunchLockerCustody(marketId_, marketRegistry_, positionManager_)
    {
        address poolManager_;
        address permit2_;
        try _lockerPositionManager.poolManager() returns (IPoolManager value) {
            poolManager_ = address(value);
        } catch {}
        try ILaunchLockerPositionDependencies(positionManager_).permit2() returns (IAllowanceTransfer value) {
            permit2_ = address(value);
        } catch {}
        if (
            poolManager_.code.length == 0 || permit2_.code.length == 0 || poolManager_ == positionManager_
                || permit2_ == positionManager_ || poolManager_ == permit2_
        ) {
            revert InvalidLaunchLockerPositionDependencies(poolManager_, permit2_, positionManager_);
        }
        _lockerPoolManager = IPoolManager(poolManager_);
        _lockerPermit2 = IAllowanceTransfer(permit2_);
    }

    function compoundLockedFees()
        external
        nonReentrant
        returns (uint256 amount0, uint256 amount1, uint128 liquidityAdded)
    {
        CompoundContext memory context;
        (context.marketId, context.tokenId, context.poolId) = _lockedPositionIdentity();
        (context.key, context.info, context.liquidityBefore) =
            _requireCanonicalPosition(context.tokenId, context.poolId);

        _collectLockedFees(context.tokenId, context.key);
        (V4PoolKey memory collectedKey, PositionInfo collectedInfo, uint128 collectedLiquidity) =
            _requireCanonicalPosition(context.tokenId, context.poolId);
        if (
            keccak256(abi.encode(collectedKey)) != keccak256(abi.encode(context.key))
                || PositionInfo.unwrap(collectedInfo) != PositionInfo.unwrap(context.info)
                || collectedLiquidity != context.liquidityBefore
        ) revert LockedPositionLiquidityMismatch(context.tokenId, collectedLiquidity, context.liquidityBefore);

        (context.currency0, context.currency1) = _lockedCurrencies();
        context.balance0 = _lockedBalance(context.currency0);
        context.balance1 = _lockedBalance(context.currency1);
        (liquidityAdded, amount0, amount1) =
            _compoundPlan(context.poolId, context.info, context.liquidityBefore, context.balance0, context.balance1);
        if (liquidityAdded == 0) return (0, 0, 0);

        _approveCompoundAsset(context.currency0, amount0);
        _approveCompoundAsset(context.currency1, amount1);
        _increaseLockedLiquidity(context.tokenId, context.key, liquidityAdded, amount0, amount1);
        _revokeCompoundAsset(context.currency0);
        _revokeCompoundAsset(context.currency1);

        uint256 remaining0 = _lockedBalance(context.currency0);
        uint256 remaining1 = _lockedBalance(context.currency1);
        _requireConsumed(context.currency0, context.balance0, remaining0, amount0);
        _requireConsumed(context.currency1, context.balance1, remaining1, amount1);

        (V4PoolKey memory finalKey, PositionInfo finalInfo, uint128 liquidityAfter) =
            _requireCanonicalPosition(context.tokenId, context.poolId);
        uint256 expectedLiquidity = uint256(context.liquidityBefore) + liquidityAdded;
        if (
            keccak256(abi.encode(finalKey)) != keccak256(abi.encode(context.key))
                || PositionInfo.unwrap(finalInfo) != PositionInfo.unwrap(context.info)
                || liquidityAfter != expectedLiquidity
        ) revert LockedPositionLiquidityMismatch(context.tokenId, liquidityAfter, expectedLiquidity);

        emit LockedFeesCompounded(context.marketId, amount0, amount1, liquidityAdded, remaining0, remaining1);
    }

    function _collectLockedFees(uint256 tokenId, V4PoolKey memory key) private {
        bytes memory actions =
            abi.encodePacked(bytes1(uint8(Actions.INCREASE_LIQUIDITY)), bytes1(uint8(Actions.TAKE_PAIR)));
        bytes[] memory params = new bytes[](2);
        params[0] = abi.encode(tokenId, uint256(0), uint128(0), uint128(0), bytes(""));
        params[1] = abi.encode(key.currency0, key.currency1, address(this));
        _lockerPositionManager.modifyLiquidities(abi.encode(actions, params), block.timestamp);
    }

    function _increaseLockedLiquidity(
        uint256 tokenId,
        V4PoolKey memory key,
        uint128 liquidity,
        uint256 amount0,
        uint256 amount1
    ) private {
        bytes memory actions = abi.encodePacked(
            bytes1(uint8(Actions.INCREASE_LIQUIDITY)), bytes1(uint8(Actions.SETTLE_PAIR))
        );
        bytes[] memory params = new bytes[](2);
        params[0] = abi.encode(tokenId, uint256(liquidity), uint128(amount0), uint128(amount1), bytes(""));
        params[1] = abi.encode(key.currency0, key.currency1);
        uint256 nativeValue = Currency.unwrap(key.currency0) == address(0) ? amount0 : 0;
        _lockerPositionManager.modifyLiquidities{value: nativeValue}(abi.encode(actions, params), block.timestamp);
    }

    function _compoundPlan(
        bytes32 poolId,
        PositionInfo info,
        uint128 liquidityBefore,
        uint256 balance0,
        uint256 balance1
    ) private view returns (uint128 liquidity, uint256 amount0, uint256 amount1) {
        uint160 sqrtPriceX96;
        (sqrtPriceX96,,,) = _lockerPoolManager.getSlot0(PoolId.wrap(poolId));
        int24 tickLower = info.tickLower();
        int24 tickUpper = info.tickUpper();
        uint160 sqrtLowerX96 = TickMath.getSqrtPriceAtTick(tickLower);
        uint160 sqrtUpperX96 = TickMath.getSqrtPriceAtTick(tickUpper);
        uint256 bounded0 = balance0 > type(uint128).max ? type(uint128).max : balance0;
        uint256 bounded1 = balance1 > type(uint128).max ? type(uint128).max : balance1;
        liquidity =
            LiquidityAmounts.getLiquidityForAmounts(sqrtPriceX96, sqrtLowerX96, sqrtUpperX96, bounded0, bounded1);
        uint128 capacity = type(uint128).max - liquidityBefore;
        if (liquidity > capacity) liquidity = capacity;
        if (liquidity == 0) return (0, 0, 0);

        if (sqrtPriceX96 <= sqrtLowerX96) {
            amount0 = SqrtPriceMath.getAmount0Delta(sqrtLowerX96, sqrtUpperX96, liquidity, true);
        } else if (sqrtPriceX96 < sqrtUpperX96) {
            amount0 = SqrtPriceMath.getAmount0Delta(sqrtPriceX96, sqrtUpperX96, liquidity, true);
            amount1 = SqrtPriceMath.getAmount1Delta(sqrtLowerX96, sqrtPriceX96, liquidity, true);
        } else {
            amount1 = SqrtPriceMath.getAmount1Delta(sqrtLowerX96, sqrtUpperX96, liquidity, true);
        }
        if (amount0 > balance0) revert LockedCompoundBalanceMismatch(_lockerCurrency0, amount0, balance0);
        if (amount1 > balance1) revert LockedCompoundBalanceMismatch(_lockerCurrency1, amount1, balance1);
        if (amount0 > type(uint128).max) {
            revert LockedCompoundAmountOverflow(_lockerCurrency0, amount0, type(uint128).max);
        }
        if (amount1 > type(uint128).max) {
            revert LockedCompoundAmountOverflow(_lockerCurrency1, amount1, type(uint128).max);
        }
    }

    function _requireCanonicalPosition(uint256 tokenId, bytes32 expectedPoolId)
        private
        view
        returns (V4PoolKey memory key, PositionInfo info, uint128 liquidity)
    {
        _requireLockedPositionOwnership();
        (key, info) = _lockerPositionManager.getPoolAndPositionInfo(tokenId);
        bytes32 suppliedPoolId = keccak256(abi.encode(key));
        (address currency0, address currency1) = _lockedCurrencies();
        if (key.tickSpacing < 1) revert InvalidLockedPositionData(tokenId, suppliedPoolId, expectedPoolId);
        int24 expectedLower = (TickMath.MIN_TICK / key.tickSpacing) * key.tickSpacing;
        int24 expectedUpper = (TickMath.MAX_TICK / key.tickSpacing) * key.tickSpacing;
        if (
            suppliedPoolId != expectedPoolId || info.poolId() != bytes25(expectedPoolId)
                || Currency.unwrap(key.currency0) != currency0 || Currency.unwrap(key.currency1) != currency1
                || info.tickLower() != expectedLower || info.tickUpper() != expectedUpper
        ) revert InvalidLockedPositionData(tokenId, suppliedPoolId, expectedPoolId);
        liquidity = _lockerPositionManager.getPositionLiquidity(tokenId);
        if (liquidity == 0) revert LockedPositionLiquidityMismatch(tokenId, 0, 1);
    }

    function _approveCompoundAsset(address currency, uint256 amount) private {
        if (currency == address(0) || amount == 0) return;
        if (amount > type(uint160).max) {
            revert LockedCompoundAmountOverflow(currency, amount, type(uint160).max);
        }
        IERC20(currency).forceApprove(address(_lockerPermit2), amount);
        _lockerPermit2.approve(currency, address(_lockerPositionManager), uint160(amount), type(uint48).max);
    }

    function _revokeCompoundAsset(address currency) private {
        if (currency == address(0)) return;
        _lockerPermit2.approve(currency, address(_lockerPositionManager), 0, 0);
        IERC20(currency).forceApprove(address(_lockerPermit2), 0);
    }

    function _lockedBalance(address currency) private view returns (uint256) {
        if (currency == address(0)) return address(this).balance;
        return IERC20(currency).balanceOf(address(this));
    }

    function _requireConsumed(address currency, uint256 beforeBalance, uint256 afterBalance, uint256 expected)
        private
        pure
    {
        uint256 actual = beforeBalance >= afterBalance ? beforeBalance - afterBalance : type(uint256).max;
        if (actual != expected) revert LockedCompoundBalanceMismatch(currency, expected, actual);
    }
}
