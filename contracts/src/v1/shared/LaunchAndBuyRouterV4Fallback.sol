// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {PoolKey as V4PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {IV4Router} from "@uniswap/v4-periphery/src/interfaces/IV4Router.sol";
import {V4Router} from "@uniswap/v4-periphery/src/V4Router.sol";
import {Actions} from "@uniswap/v4-periphery/src/libraries/Actions.sol";

import {CreateMarketParams, ITickerGardenCurve} from "../interfaces/IV1Protocol.sol";
import {LaunchAndBuyRouterERC20} from "./LaunchAndBuyRouterERC20.sol";

/// @notice Atomic native-ETH fallback for an ERC-20 Quote first buy.
/// @dev A release binds one canonical direct native/Quote pool shape. The caller supplies only a
///      maximum ETH input through msg.value; exact-output execution and balance-delta checks prevent
///      display prices or stale estimates from controlling settlement.
abstract contract LaunchAndBuyRouterV4Fallback is LaunchAndBuyRouterERC20, V4Router {
    uint24 internal immutable _nativeQuotePoolFee;
    int24 internal immutable _nativeQuoteTickSpacing;
    address private _activeFallbackQuote;

    struct NativeFallbackState {
        address quoteAsset;
        address curve;
        uint256 nativeBalanceBefore;
        uint256 quoteBalanceBefore;
        uint256 fee;
        uint256 maxNativeIn;
        uint256 quoteSpent;
    }

    error InvalidNativeQuotePoolShape(uint24 fee, int24 tickSpacing);
    error NativeFallbackAmountTooLarge(uint256 amount);
    error NativeFallbackUnavailable(address quoteAsset);
    error NativeFallbackPaymentForbidden(address token, address payer, uint256 amount);

    constructor(
        address factory_,
        address approvedQuoteRegistry_,
        address poolManager_,
        uint24 nativeQuotePoolFee_,
        int24 nativeQuoteTickSpacing_
    ) LaunchAndBuyRouterERC20(factory_, approvedQuoteRegistry_) V4Router(IPoolManager(poolManager_)) {
        if (poolManager_.code.length == 0) revert InvalidLaunchRouterDependency(poolManager_);
        if (nativeQuotePoolFee_ == 0 || nativeQuoteTickSpacing_ <= 0) {
            revert InvalidNativeQuotePoolShape(nativeQuotePoolFee_, nativeQuoteTickSpacing_);
        }
        _nativeQuotePoolFee = nativeQuotePoolFee_;
        _nativeQuoteTickSpacing = nativeQuoteTickSpacing_;
    }

    function _launchAndBuyERC20FromNative(
        address creator,
        CreateMarketParams calldata params,
        uint256 firstBuyAmount,
        uint256 minTokensOut,
        address recipient
    ) internal returns (bytes32 marketId, address memeToken, uint256 tokensOut, uint256 nativeRefund) {
        _requireLaunchInput(creator, firstBuyAmount, recipient);
        _requireFactoryBinding();
        NativeFallbackState memory state;
        state.quoteAsset = _requireERC20Quote(params.quoteAssetConfigId);
        state.fee = _launchFactory.launchFee();
        if (msg.value <= state.fee) revert InvalidLaunchAndBuyValue(state.fee + 1, msg.value);
        state.maxNativeIn = msg.value - state.fee;
        if (firstBuyAmount > type(uint128).max || state.maxNativeIn > type(uint128).max) {
            revert NativeFallbackAmountTooLarge(firstBuyAmount > state.maxNativeIn ? firstBuyAmount : state.maxNativeIn);
        }

        state.nativeBalanceBefore = address(this).balance - msg.value;
        state.quoteBalanceBefore = _balanceOf(state.quoteAsset, address(this));
        nativeRefund = _swapNativeForExactQuote(state.quoteAsset, firstBuyAmount, state.maxNativeIn);
        _requireBalance(state.quoteAsset, address(this), state.quoteBalanceBefore + firstBuyAmount);

        (marketId, memeToken, state.curve,) = _launchFactory.createMarketFor{value: state.fee}(creator, params);
        _requireCreatedMarket(marketId, memeToken, state.curve);
        _approveCurveExact(state.quoteAsset, state.curve, firstBuyAmount);
        (tokensOut, state.quoteSpent) = ITickerGardenCurve(state.curve).buy(firstBuyAmount, minTokensOut, recipient);
        if (state.quoteSpent > firstBuyAmount) revert InvalidQuoteSpent(firstBuyAmount, state.quoteSpent);
        uint256 quoteRefund = firstBuyAmount - state.quoteSpent;
        _requireAllowance(state.quoteAsset, state.curve, 0);
        _requireBalance(state.quoteAsset, address(this), state.quoteBalanceBefore + quoteRefund);
        if (quoteRefund != 0) _transferQuoteExact(state.quoteAsset, creator, quoteRefund);
        _requireBalance(state.quoteAsset, address(this), state.quoteBalanceBefore);

        if (nativeRefund != 0) {
            (bool success,) = payable(creator).call{value: nativeRefund}("");
            if (!success) revert NativeRefundTransferFailed(creator, nativeRefund);
        }
        if (address(this).balance != state.nativeBalanceBefore) {
            revert NativeRefundBalanceMismatch(state.nativeBalanceBefore, address(this).balance);
        }
    }

    function _swapNativeForExactQuote(address quoteAsset, uint256 quoteAmount, uint256 maxNativeIn)
        private
        returns (uint256 nativeRefund)
    {
        uint256 balanceBefore = address(this).balance;
        _activeFallbackQuote = quoteAsset;
        V4PoolKey memory key = V4PoolKey({
            currency0: Currency.wrap(address(0)),
            currency1: Currency.wrap(quoteAsset),
            fee: _nativeQuotePoolFee,
            tickSpacing: _nativeQuoteTickSpacing,
            hooks: IHooks(address(0))
        });
        IV4Router.ExactOutputSingleParams memory swap = IV4Router.ExactOutputSingleParams({
            poolKey: key,
            zeroForOne: true,
            amountOut: uint128(quoteAmount),
            amountInMaximum: uint128(maxNativeIn),
            minHopPriceX36: 0,
            hookData: bytes("")
        });
        bytes memory actions = abi.encodePacked(
            bytes1(uint8(Actions.SWAP_EXACT_OUT_SINGLE)),
            bytes1(uint8(Actions.SETTLE_ALL)),
            bytes1(uint8(Actions.TAKE_ALL))
        );
        bytes[] memory actionParams = new bytes[](3);
        actionParams[0] = abi.encode(swap);
        actionParams[1] = abi.encode(Currency.wrap(address(0)), maxNativeIn);
        actionParams[2] = abi.encode(Currency.wrap(quoteAsset), quoteAmount);
        poolManager.unlock(abi.encode(actions, actionParams));
        _activeFallbackQuote = address(0);
        if (address(this).balance > balanceBefore || balanceBefore - address(this).balance > maxNativeIn) {
            revert NativeRefundBalanceMismatch(balanceBefore - maxNativeIn, address(this).balance);
        }
        nativeRefund = maxNativeIn - (balanceBefore - address(this).balance);
    }

    function msgSender() public view override returns (address) {
        return address(this);
    }

    function _validatePoolKey(V4PoolKey memory key) internal view override {
        address quoteAsset = _activeFallbackQuote;
        if (
            quoteAsset == address(0) || Currency.unwrap(key.currency0) != address(0)
                || Currency.unwrap(key.currency1) != quoteAsset || key.fee != _nativeQuotePoolFee
                || key.tickSpacing != _nativeQuoteTickSpacing || address(key.hooks) != address(0)
        ) revert NativeFallbackUnavailable(quoteAsset);
    }

    function _pay(Currency token, address payer, uint256 amount) internal pure override {
        revert NativeFallbackPaymentForbidden(Currency.unwrap(token), payer, amount);
    }
}
