// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IAllowanceTransfer} from "permit2/src/interfaces/IAllowanceTransfer.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {PoolKey as V4PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {IPositionManager} from "@uniswap/v4-periphery/src/interfaces/IPositionManager.sol";
import {Actions} from "@uniswap/v4-periphery/src/libraries/Actions.sol";
import {PositionInfo} from "@uniswap/v4-periphery/src/libraries/PositionInfoLibrary.sol";
import {PositionInfoLibrary} from "@uniswap/v4-periphery/src/libraries/PositionInfoLibrary.sol";

import {ILaunchLocker, ITickerGardenMemeHook, MarketView, PoolBinding, PoolKey} from "../interfaces/IV1Protocol.sol";
import {GraduationPoolMath} from "../libraries/GraduationPoolMath.sol";
import {V1Identifiers} from "./V1Identifiers.sol";
import {V1Create2} from "./V1Create2.sol";
import {GraduationExecutorAssetAccounting} from "./GraduationExecutorAssetAccounting.sol";
import {ILaunchLockerPositionOwner} from "./LaunchLockerBinding.sol";

interface IGraduationPoolRegistryDependencies {
    function factory() external view returns (address);
}

interface IGraduationPositionManagerDependencies {
    function poolManager() external view returns (IPoolManager);
    function permit2() external view returns (IAllowanceTransfer);
}

/// @notice Canonical v4 initialize, exact mint/settle and atomic source activation shared by GraduationExecutor.
abstract contract GraduationExecutorPoolExecution is GraduationExecutorAssetAccounting {
    using PositionInfoLibrary for PositionInfo;
    using SafeERC20 for IERC20;

    uint8 private constant BINDING_INITIALIZE_SEEN = 2;
    uint8 private constant BINDING_ACTIVE = 3;

    address internal immutable _graduationFactory;
    IPoolManager internal immutable _graduationPoolManager;
    IPositionManager internal immutable _graduationPositionManager;
    IAllowanceTransfer internal immutable _graduationPermit2;
    ITickerGardenMemeHook internal immutable _graduationHook;

    struct PoolExecutionContext {
        PoolKey key;
        GraduationPoolMath.PoolPlan poolPlan;
        address launchLocker;
        uint256 tokenId;
        uint32 expectedSourceVersion;
    }

    error InvalidGraduationPoolDependencies(
        address poolManager, address positionManager, address permit2, address hook
    );
    error InvalidGraduationHookBinding(address hook, address executor, address marketRegistry, address poolManager);
    error InvalidLaunchLockerCreationCode();
    error UnexpectedGraduationPoolId(bytes32 supplied, bytes32 expected);
    error UnexpectedGraduationInitialTick(int24 supplied, int24 expected);
    error InvalidGraduationDust(
        uint256 quoteDust,
        uint256 memeRemainder,
        uint256 expectedLockedExcessQuote,
        uint256 expectedLockedExcessMeme
    );
    error GraduationAssetTransferFailed(address asset, address recipient, uint256 amount);
    error UnexpectedLockedPosition(uint256 tokenId, bytes32 poolId, bytes32 expectedPoolId);
    error UnexpectedPositionCounter(uint256 supplied, uint256 expected);
    error UnexpectedPositionOwner(uint256 tokenId, address supplied, address expected);
    error UnexpectedPositionData(uint256 tokenId);
    error UnexpectedHookBinding(bytes32 poolId, uint8 supplied, uint8 expected);
    error UnexpectedCommittedSource(bytes32 marketId, uint32 supplied, uint32 expected);

    constructor(
        address marketRegistry_,
        address quoteRegistry_,
        address poolManager_,
        address positionManager_,
        address hook_
    ) GraduationExecutorAssetAccounting(marketRegistry_, quoteRegistry_) {
        address permit2_;
        address boundPoolManager;
        if (positionManager_.code.length != 0) {
            try IGraduationPositionManagerDependencies(positionManager_).permit2() returns (IAllowanceTransfer value) {
                permit2_ = address(value);
            } catch {}
            try IGraduationPositionManagerDependencies(positionManager_).poolManager() returns (IPoolManager value) {
                boundPoolManager = address(value);
            } catch {}
        }
        if (
            poolManager_.code.length == 0 || positionManager_.code.length == 0 || permit2_.code.length == 0
                || hook_.code.length == 0 || poolManager_ == positionManager_ || poolManager_ == permit2_
                || poolManager_ == hook_ || positionManager_ == permit2_ || positionManager_ == hook_
                || permit2_ == hook_ || boundPoolManager != poolManager_
        ) {
            revert InvalidGraduationPoolDependencies(poolManager_, positionManager_, permit2_, hook_);
        }
        if (
            ITickerGardenMemeHook(hook_).graduationExecutor() != address(this)
                || ITickerGardenMemeHook(hook_).marketRegistry() != marketRegistry_
                || ITickerGardenMemeHook(hook_).poolManager() != poolManager_
        ) {
            revert InvalidGraduationHookBinding(
                hook_,
                ITickerGardenMemeHook(hook_).graduationExecutor(),
                ITickerGardenMemeHook(hook_).marketRegistry(),
                ITickerGardenMemeHook(hook_).poolManager()
            );
        }

        address factory_ = IGraduationPoolRegistryDependencies(marketRegistry_).factory();
        if (factory_ == address(0)) {
            revert InvalidGraduationPoolDependencies(poolManager_, positionManager_, permit2_, hook_);
        }
        _graduationFactory = factory_;
        _graduationPoolManager = IPoolManager(poolManager_);
        _graduationPositionManager = IPositionManager(positionManager_);
        _graduationPermit2 = IAllowanceTransfer(permit2_);
        _graduationHook = ITickerGardenMemeHook(hook_);
    }

    function predictLaunchLocker(bytes32 marketId) public view returns (address) {
        bytes memory initCode = _launchLockerInitCode(marketId);
        return V1Create2.predict(address(this), _lockerSalt(marketId), keccak256(initCode));
    }

    function marketRegistry() external view returns (address) {
        return address(_graduationMarketRegistry);
    }

    function approvedQuoteRegistry() external view returns (address) {
        return address(_graduationQuoteRegistry);
    }

    function factory() external view returns (address) {
        return _graduationFactory;
    }

    function poolManager() external view returns (address) {
        return address(_graduationPoolManager);
    }

    function positionManager() external view returns (address) {
        return address(_graduationPositionManager);
    }

    function permit2() external view returns (address) {
        return address(_graduationPermit2);
    }

    function hook() external view returns (address) {
        return address(_graduationHook);
    }

    function _executeGraduationAssetPlan(
        bytes32 marketId,
        MarketView memory sweptMarket,
        GraduationAssetPlan memory assetPlan
    ) internal override returns (address launchLocker) {
        PoolExecutionContext memory context;
        context.key = _graduationMarketRegistry.canonicalPoolKey(marketId);
        if (context.key.hooks != address(_graduationHook)) {
            revert InvalidGraduationPoolDependencies(
                address(_graduationPoolManager),
                address(_graduationPositionManager),
                address(_graduationPermit2),
                address(_graduationHook)
            );
        }
        context.poolPlan = GraduationPoolMath.derive(
            context.key, assetPlan.quoteAsset, assetPlan.memeToken, assetPlan.poolQuoteAmount, assetPlan.poolMemeAmount
        );
        if (sweptMarket.runtime.sourceVersion == type(uint32).max) {
            revert UnexpectedCommittedSource(marketId, sweptMarket.runtime.sourceVersion, 0);
        }
        context.expectedSourceVersion = sweptMarket.runtime.sourceVersion + 1;
        _deployLocker(marketId, context);
        _registerAndInitialize(marketId, context);
        _mintAndVerify(context);
        _routeDust(assetPlan, context);
        _activateAndCommit(marketId, context);
        launchLocker = context.launchLocker;
    }

    function _deployLocker(bytes32 marketId, PoolExecutionContext memory context) private {
        context.launchLocker = V1Create2.deploy(_lockerSalt(marketId), _launchLockerInitCode(marketId));
        if (context.launchLocker != predictLaunchLocker(marketId)) {
            revert InvalidLaunchLocker(context.launchLocker);
        }

        bytes32 lockerPoolId;
        (context.tokenId, lockerPoolId) = ILaunchLocker(context.launchLocker).lockedPosition();
        if (
            ILaunchLocker(context.launchLocker).marketId() != marketId || lockerPoolId != context.poolPlan.poolId
                || context.tokenId != _graduationPositionManager.nextTokenId()
        ) revert UnexpectedLockedPosition(context.tokenId, lockerPoolId, context.poolPlan.poolId);
    }

    function _routeDust(GraduationAssetPlan memory assetPlan, PoolExecutionContext memory context) private {
        (uint256 quoteMint, uint256 memeMint) = context.key.currency0 == assetPlan.quoteAsset
            ? (context.poolPlan.mintAmount0, context.poolPlan.mintAmount1)
            : (context.poolPlan.mintAmount1, context.poolPlan.mintAmount0);
        uint256 quoteDust = assetPlan.sweptQuote - quoteMint;
        uint256 memeRemainder = assetPlan.sweptTokens - memeMint;
        if (quoteDust < assetPlan.lockedExcessQuote || memeRemainder < assetPlan.lockedExcessMeme) {
            revert InvalidGraduationDust(
                quoteDust, memeRemainder, assetPlan.lockedExcessQuote, assetPlan.lockedExcessMeme
            );
        }
        _transferGraduationAsset(assetPlan.quoteAsset, context.launchLocker, quoteDust);
        _transferGraduationAsset(assetPlan.memeToken, context.launchLocker, memeRemainder);
    }

    function _registerAndInitialize(bytes32 marketId, PoolExecutionContext memory context) private {
        bytes32 registeredPoolId =
            _graduationHook.registerExpectedPool(marketId, context.key, context.expectedSourceVersion);
        if (registeredPoolId != context.poolPlan.poolId) {
            revert UnexpectedGraduationPoolId(registeredPoolId, context.poolPlan.poolId);
        }

        V4PoolKey memory v4Key = _toV4PoolKey(context.key);
        int24 initializedTick = _graduationPoolManager.initialize(v4Key, context.poolPlan.sqrtPriceX96);
        if (initializedTick != context.poolPlan.initialTick) {
            revert UnexpectedGraduationInitialTick(initializedTick, context.poolPlan.initialTick);
        }
        _requireBindingStatus(context.poolPlan.poolId, BINDING_INITIALIZE_SEEN);
    }

    function _mintAndVerify(PoolExecutionContext memory context) private {
        V4PoolKey memory v4Key = _toV4PoolKey(context.key);
        _approvePositionAsset(context.key.currency0, context.poolPlan.mintAmount0);
        _approvePositionAsset(context.key.currency1, context.poolPlan.mintAmount1);
        bytes memory actions =
            abi.encodePacked(bytes1(uint8(Actions.MINT_POSITION)), bytes1(uint8(Actions.SETTLE_PAIR)));
        bytes[] memory params = new bytes[](2);
        params[0] = abi.encode(
            v4Key,
            context.poolPlan.tickLower,
            context.poolPlan.tickUpper,
            uint256(context.poolPlan.liquidity),
            uint128(context.poolPlan.mintAmount0),
            uint128(context.poolPlan.mintAmount1),
            context.launchLocker,
            bytes("")
        );
        params[1] = abi.encode(v4Key.currency0, v4Key.currency1);
        uint256 nativeValue = context.key.currency0 == address(0) ? context.poolPlan.mintAmount0 : 0;
        _graduationPositionManager.modifyLiquidities{value: nativeValue}(abi.encode(actions, params), block.timestamp);
        _revokePositionAsset(context.key.currency0);
        _revokePositionAsset(context.key.currency1);

        uint256 expectedNextTokenId = context.tokenId + 1;
        uint256 actualNextTokenId = _graduationPositionManager.nextTokenId();
        if (actualNextTokenId != expectedNextTokenId) {
            revert UnexpectedPositionCounter(actualNextTokenId, expectedNextTokenId);
        }
        _requirePosition(context.tokenId, context.launchLocker, context.poolPlan, v4Key);
    }

    function _activateAndCommit(bytes32 marketId, PoolExecutionContext memory context) private {
        _graduationHook.activatePool(context.poolPlan.poolId);
        _requireBindingStatus(context.poolPlan.poolId, BINDING_ACTIVE);
        uint32 committedSourceVersion = _graduationMarketRegistry.commitPoolCreated(marketId, context.poolPlan.poolId);
        if (committedSourceVersion != context.expectedSourceVersion) {
            revert UnexpectedCommittedSource(marketId, committedSourceVersion, context.expectedSourceVersion);
        }
    }

    function _launchLockerCreationCode() internal view virtual returns (bytes memory);

    function _launchLockerInitCode(bytes32 marketId) private view returns (bytes memory initCode) {
        bytes memory creationCode = _launchLockerCreationCode();
        if (creationCode.length == 0) revert InvalidLaunchLockerCreationCode();
        initCode = bytes.concat(
            creationCode, abi.encode(marketId, address(_graduationMarketRegistry), address(_graduationPositionManager))
        );
    }

    function _lockerSalt(bytes32 marketId) private view returns (bytes32) {
        return
            V1Identifiers.componentSalt(block.chainid, _graduationFactory, marketId, V1Identifiers.ComponentKind.LOCKER);
    }

    function _toV4PoolKey(PoolKey memory key) private pure returns (V4PoolKey memory) {
        return V4PoolKey({
            currency0: Currency.wrap(key.currency0),
            currency1: Currency.wrap(key.currency1),
            fee: key.fee,
            tickSpacing: key.tickSpacing,
            hooks: IHooks(key.hooks)
        });
    }

    function _approvePositionAsset(address asset, uint256 amount) private {
        if (asset == address(0)) return;
        IERC20(asset).forceApprove(address(_graduationPermit2), amount);
        _graduationPermit2.approve(asset, address(_graduationPositionManager), uint160(amount), type(uint48).max);
    }

    function _revokePositionAsset(address asset) private {
        if (asset == address(0)) return;
        _graduationPermit2.approve(asset, address(_graduationPositionManager), 0, 0);
        IERC20(asset).forceApprove(address(_graduationPermit2), 0);
    }

    function _transferGraduationAsset(address asset, address recipient, uint256 amount) private {
        if (amount == 0) return;
        uint256 recipientBalanceBefore = asset == address(0) ? recipient.balance : IERC20(asset).balanceOf(recipient);
        if (asset == address(0)) {
            (bool success,) = payable(recipient).call{value: amount}("");
            if (!success) revert GraduationAssetTransferFailed(asset, recipient, amount);
        } else {
            IERC20(asset).safeTransfer(recipient, amount);
        }
        uint256 recipientBalanceAfter = asset == address(0) ? recipient.balance : IERC20(asset).balanceOf(recipient);
        if (recipientBalanceAfter < recipientBalanceBefore || recipientBalanceAfter - recipientBalanceBefore != amount)
        {
            revert GraduationAssetTransferFailed(asset, recipient, amount);
        }
    }

    function _requireBindingStatus(bytes32 poolId, uint8 expected) private view {
        PoolBinding memory binding = _graduationHook.poolBinding(poolId);
        if (binding.status != expected || binding.keyHash != poolId) {
            revert UnexpectedHookBinding(poolId, binding.status, expected);
        }
    }

    function _requirePosition(
        uint256 tokenId,
        address launchLocker,
        GraduationPoolMath.PoolPlan memory poolPlan,
        V4PoolKey memory expectedKey
    ) private view {
        address owner;
        try ILaunchLockerPositionOwner(address(_graduationPositionManager)).ownerOf(tokenId) returns (address value) {
            owner = value;
        } catch {
            revert UnexpectedPositionOwner(tokenId, address(0), launchLocker);
        }
        if (owner != launchLocker) revert UnexpectedPositionOwner(tokenId, owner, launchLocker);

        (V4PoolKey memory actualKey, PositionInfo info) = _graduationPositionManager.getPoolAndPositionInfo(tokenId);
        if (
            keccak256(abi.encode(actualKey)) != keccak256(abi.encode(expectedKey))
                || info.poolId() != bytes25(poolPlan.poolId) || info.tickLower() != poolPlan.tickLower
                || info.tickUpper() != poolPlan.tickUpper
                || _graduationPositionManager.getPositionLiquidity(tokenId) != poolPlan.liquidity
        ) revert UnexpectedPositionData(tokenId);
    }
}
