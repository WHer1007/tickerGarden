// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {PoolId} from "@uniswap/v4-core/src/types/PoolId.sol";
import {PoolKey as V4PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {SwapParams as V4SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {MarketView, PoolKey} from "../interfaces/IV1Protocol.sol";
import {TickerGardenMemeHookFeeExecution} from "./TickerGardenMemeHookFeeExecution.sol";

/// @notice Only the FeeVault may exchange owned rewards, in this Hook's own canonical pool.
abstract contract TickerGardenRewardConversion is TickerGardenMemeHookFeeExecution {
    using SafeERC20 for IERC20;
    uint256 public constant MAX_SQRT_PRICE_MOVE_BPS = 100;
    bytes32 private _conversionContext;
    bool private _callbackUsed;
    error InvalidRewardConversion();
    error InexactRewardConversion();

    constructor(address registry, address manager, address vault, address graduation)
        TickerGardenMemeHookFeeExecution(registry, manager, vault, graduation)
    {}

    function convertRewards(bytes32 marketId, uint256 amount, uint256 minimumQuote, uint256 deadline)
        external
        override
        returns (uint256 spent, uint256 received)
    {
        if (
            msg.sender != _hookProtocolFeeVault || _conversionContext != bytes32(0) || amount == 0
                || amount > uint256(uint128(type(int128).max)) || minimumQuote == 0 || deadline < block.timestamp
        ) {
            revert InvalidRewardConversion();
        }
        MarketView memory value = _hookMarketRegistry.market(marketId);
        PoolKey memory key = _hookMarketRegistry.canonicalPoolKey(marketId);
        bytes32 poolId = keccak256(abi.encode(key));
        if (
            value.runtime.launchPhase != 1 || value.runtime.poolId != poolId
                || value.config.graduatedHook != address(this) || _poolBindings[poolId].status != BINDING_ACTIVE
                || _poolBindings[poolId].marketId != marketId
                || _poolBindings[poolId].sourceVersion != value.runtime.sourceVersion || key.hooks != address(this)
                || key.fee != 0
        ) revert InvalidRewardConversion();
        bool zeroForOne = key.currency0 == value.config.memeToken;
        if (
            (zeroForOne ? key.currency1 : key.currency0) != value.config.quoteAsset
                || (zeroForOne ? key.currency0 : key.currency1) != value.config.memeToken
        ) revert InvalidRewardConversion();
        IERC20 meme = IERC20(value.config.memeToken);
        uint256 memeBefore = meme.balanceOf(address(this));
        meme.safeTransferFrom(msg.sender, address(this), amount);
        if (meme.balanceOf(address(this)) != memeBefore + amount) revert InexactRewardConversion();
        bytes memory data = abi.encode(key, zeroForOne, amount);
        _conversionContext = keccak256(data);
        _callbackUsed = false;
        (spent, received) = abi.decode(IPoolManager(_hookPoolManager).unlock(data), (uint256, uint256));
        if (!_callbackUsed || spent == 0 || spent > amount || received < minimumQuote) {
            revert InvalidRewardConversion();
        }
        _conversionContext = bytes32(0);
        if (amount > spent) meme.safeTransfer(_hookProtocolFeeVault, amount - spent);
        address quote = value.config.quoteAsset;
        if (quote == address(0)) {
            (bool ok,) = payable(_hookProtocolFeeVault).call{value: received}("");
            if (!ok) revert InexactRewardConversion();
        } else {
            uint256 beforePayment = IERC20(quote).balanceOf(address(this));
            IERC20(quote).safeTransfer(_hookProtocolFeeVault, received);
            if (IERC20(quote).balanceOf(address(this)) + received != beforePayment) revert InexactRewardConversion();
        }
        if (meme.balanceOf(address(this)) != memeBefore) revert InexactRewardConversion();
    }

    function unlockCallback(bytes calldata data) external override returns (bytes memory) {
        if (
            msg.sender != _hookPoolManager || _conversionContext == bytes32(0) || _conversionContext != keccak256(data)
                || _callbackUsed
        ) revert InvalidRewardConversion();
        _callbackUsed = true;
        (PoolKey memory key, bool zeroForOne, uint256 amount) = abi.decode(data, (PoolKey, bool, uint256));
        IPoolManager manager = IPoolManager(_hookPoolManager);
        (uint160 current,, uint24 protocolFee, uint24 lpFee) =
            StateLibrary.getSlot0(manager, PoolId.wrap(keccak256(abi.encode(key))));
        if (protocolFee != 0 || lpFee != 0) revert InvalidRewardConversion();
        uint256 limit = zeroForOne ? uint256(current) * 9900 / 10000 : uint256(current) * 10000 / 9900;
        if (limit <= TickMath.MIN_SQRT_PRICE) limit = TickMath.MIN_SQRT_PRICE + 1;
        if (limit >= TickMath.MAX_SQRT_PRICE) limit = TickMath.MAX_SQRT_PRICE - 1;
        BalanceDelta delta = manager.swap(
            V4PoolKey(
                Currency.wrap(key.currency0), Currency.wrap(key.currency1), key.fee, key.tickSpacing, IHooks(key.hooks)
            ),
            V4SwapParams(zeroForOne, -int256(amount), uint160(limit)),
            ""
        );
        int128 input = zeroForOne ? delta.amount0() : delta.amount1();
        int128 output = zeroForOne ? delta.amount1() : delta.amount0();
        if (input >= 0 || output <= 0) revert InvalidRewardConversion();
        uint256 spent = uint256(-int256(input));
        uint256 received = uint256(uint128(output));
        if (spent > amount) revert InvalidRewardConversion();
        Currency inputCurrency = Currency.wrap(zeroForOne ? key.currency0 : key.currency1);
        manager.sync(inputCurrency);
        IERC20(Currency.unwrap(inputCurrency)).safeTransfer(address(manager), spent);
        if (manager.settle() != spent) revert InexactRewardConversion();
        _takeConversionOutput(zeroForOne ? key.currency1 : key.currency0, received);
        return abi.encode(spent, received);
    }

    function _takeConversionOutput(address asset, uint256 amount) private {
        uint256 beforeBalance = asset == address(0) ? address(this).balance : IERC20(asset).balanceOf(address(this));
        IPoolManager(_hookPoolManager).take(Currency.wrap(asset), address(this), amount);
        uint256 afterBalance = asset == address(0) ? address(this).balance : IERC20(asset).balanceOf(address(this));
        if (afterBalance != beforeBalance + amount) revert InexactRewardConversion();
    }

    receive() external payable {
        if (msg.sender != _hookPoolManager || _conversionContext == bytes32(0)) revert InvalidRewardConversion();
    }
}
